import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { AppConfig } from '../core/types.js';

const { Pool } = pg;

export type PgPool = InstanceType<typeof Pool>;

/**
 * Creates the shared Postgres pool when DATABASE_URL is configured.
 */
export function createPgPool(config: AppConfig): PgPool | null {
  if (!config.database.url) return null;
  return new Pool({
    connectionString: config.database.url,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
  });
}

/**
 * Applies SQL migrations from packages/db-schema in filename order.
 */
export async function runMigrations(config: AppConfig, pool: PgPool | null): Promise<void> {
  if (!pool) return;
  await pool.query(`
    create table if not exists app_migration (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await fs.readdir(config.database.migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const alreadyApplied = await pool.query('select 1 from app_migration where filename = $1', [file]);
    if (alreadyApplied.rowCount) continue;
    const sql = await fs.readFile(path.join(config.database.migrationsDir, file), 'utf8');
    await pool.query('begin');
    try {
      await pool.query(sql);
      await pool.query('insert into app_migration(filename) values ($1)', [file]);
      await pool.query('commit');
    } catch (error) {
      await pool.query('rollback');
      throw error;
    }
  }
}

/**
 * Sets up LangGraph checkpoint tables in a separate Postgres schema.
 */
export async function setupLangGraphCheckpointer(config: AppConfig): Promise<boolean> {
  if (!config.database.url) return false;
  const checkpointer = createLangGraphCheckpointer(config);
  if (!checkpointer) return false;
  try {
    await checkpointer.setup();
    return true;
  } finally {
    await checkpointer.end();
  }
}

/**
 * Creates a LangGraph Postgres checkpointer when DATABASE_URL is configured.
 */
export function createLangGraphCheckpointer(config: AppConfig): PostgresSaver | null {
  if (!config.database.url) return null;
  return PostgresSaver.fromConnString(config.database.url, {
    schema: config.database.langgraphSchema,
  });
}
