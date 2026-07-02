import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getAuthTables } from '@better-auth/core/db';
import type { DBFieldAttribute } from '@better-auth/core/db';
import { createBetterAuthOptions } from './betterAuth.js';
import { loadConfig } from '../core/config.js';

/**
 * Regenerates the committed better-auth schema migration from installed package metadata.
 *
 * This does not need a live Postgres connection. It mirrors better-auth's
 * default Postgres SQL shape closely enough for reviewable migrations and fails
 * loudly if a future package adds a field type this compiler does not know.
 */
async function main() {
  const config = loadConfig();
  const sql = compilePostgresSchema(createBetterAuthOptions(config, null));
  const outFile = path.join(config.database.migrationsDir, '002_better_auth_schema.sql');
  await fs.writeFile(outFile, sql);
  console.log(`Wrote ${path.relative(config.repoRoot, outFile)}`);
}

function compilePostgresSchema(options: ReturnType<typeof createBetterAuthOptions>): string {
  const tables = Object.values(getAuthTables(options)).sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
  const modelNames = new Map(Object.entries(getAuthTables(options)).map(([model, table]) => [model, table.modelName]));
  const statements = [
    '-- Generated from better-auth 1.6.x metadata with magic-link/organization/admin plugins.',
    '-- Run `npm run auth:schema` after changing better-auth plugins or auth schema options.',
  ];

  for (const table of tables) {
    const columns = [
      '  id text primary key',
      ...Object.entries(table.fields).map(([fieldName, field]) => compileColumn(field.fieldName ?? fieldName, field, modelNames)),
    ];
    statements.push(`create table if not exists ${quoteIdent(table.modelName)} (\n${columns.join(',\n')}\n);`);
  }

  for (const table of tables) {
    for (const [fieldName, field] of Object.entries(table.fields)) {
      if (!field.index) continue;
      const column = field.fieldName ?? fieldName;
      const suffix = field.unique ? 'uidx' : 'idx';
      const unique = field.unique ? ' unique' : '';
      statements.push(`create${unique} index if not exists ${quoteIdent(`${table.modelName}_${column}_${suffix}`)} on ${quoteIdent(table.modelName)} (${quoteIdent(column)});`);
    }
  }

  return `${statements.join('\n\n')}\n`;
}

function compileColumn(columnName: string, field: DBFieldAttribute, modelNames: Map<string, string>): string {
  const parts = [`  ${quoteIdent(columnName)} ${fieldType(field)}`];
  if (field.required !== false) parts.push('not null');
  if (field.references) {
    const modelName = modelNames.get(field.references.model) ?? field.references.model;
    parts.push(`references ${quoteIdent(modelName)} (${quoteIdent(field.references.field)}) on delete ${field.references.onDelete ?? 'cascade'}`);
  }
  if (field.unique) parts.push('unique');
  if (field.type === 'date' && typeof field.defaultValue === 'function') parts.push('default CURRENT_TIMESTAMP');
  return parts.join(' ');
}

function fieldType(field: DBFieldAttribute): string {
  if (field.references?.field === 'id') return 'text';
  if (Array.isArray(field.type)) return 'text';
  switch (field.type) {
    case 'string':
      return 'text';
    case 'number':
      return field.bigint ? 'bigint' : 'integer';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'timestamptz';
    case 'json':
    case 'string[]':
    case 'number[]':
      return 'jsonb';
    default:
      throw new Error(`Unsupported better-auth field type: ${String(field.type)}`);
  }
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
