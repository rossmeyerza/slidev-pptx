import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { AppConfig } from './types.js';

/**
 * Builds runtime configuration from environment variables and repository layout.
 *
 * Defaults keep state under the repository `.data/` directory and serve static
 * files from `apps/web/dist` when present, falling back to `apps/server/public`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const repoRoot = path.resolve(appRoot, '..', '..');
  const dataDir = path.resolve(env.SLIDEV_AGENT_DATA_DIR ?? path.join(repoRoot, '.data'));
  const builtWebDir = path.join(repoRoot, 'apps', 'web', 'dist');
  const defaultWebDir = path.join(repoRoot, 'apps', 'web');
  const fallbackWebDir = path.join(repoRoot, 'apps', 'server', 'public');

  return {
    repoRoot,
    appRoot,
    dataDir,
    decksDir: path.join(dataDir, 'decks'),
    staticDir: path.resolve(env.SLIDEV_AGENT_WEB_DIR ?? (awaitableExists(builtWebDir) ? builtWebDir : defaultWebDir)),
    scaffoldKey: nonEmpty(env.DEFAULT_SCAFFOLD) ?? 'commercial-html',
    host: env.HOST ?? '127.0.0.1',
    port: parsePort(env.PORT),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://${env.HOST ?? '127.0.0.1'}:${parsePort(env.PORT)}`,
    appDomain: nonEmpty(env.APP_DOMAIN),
    decksDomain: normalizeDomain(env.DECKS_DOMAIN),
    export: {
      concurrency: parsePositiveInt(env.EXPORT_CONCURRENCY, 1),
      timeoutMs: parsePositiveInt(env.EXPORT_TIMEOUT_MS, 180_000),
    },
    import: {
      timeoutMs: parsePositiveInt(env.IMPORT_TIMEOUT_MS, 60_000),
    },
    agent: {
      baseUrl: nonEmpty(env.AGENT_BASE_URL) ?? 'http://127.0.0.1:3033/v1',
      apiKey: nonEmpty(env.AGENT_API_KEY),
      memberModel: nonEmpty(env.MEMBER_AGENT_MODEL) ?? nonEmpty(env.AGENT_MODEL) ?? 'claude-sonnet-4.6',
      adminModel: nonEmpty(env.ADMIN_AGENT_MODEL) ?? nonEmpty(env.AGENT_MODEL) ?? 'claude-opus-4.8',
      timeoutMs: parsePositiveInt(env.AGENT_TIMEOUT_MS, 120_000),
    },
    database: {
      url: nonEmpty(env.DATABASE_URL),
      migrationsDir: path.join(repoRoot, 'packages', 'db-schema'),
      ssl: env.DATABASE_SSL === 'true',
      langgraphSchema: nonEmpty(env.LANGGRAPH_SCHEMA) ?? 'langgraph',
    },
    smtp: smtpConfig(env),
    auth: {
      bypass: env.AUTH_BYPASS === 'true',
      devLink: env.AUTH_DEV_LINK === 'true',
      bootstrapAdminEmail: env.AUTH_BOOTSTRAP_ADMIN_EMAIL,
      bootstrapAdminName: env.AUTH_BOOTSTRAP_ADMIN_NAME ?? 'Admin',
      sessionDays: parsePositiveInt(env.AUTH_SESSION_DAYS, 14),
      tokenMinutes: parsePositiveInt(env.AUTH_TOKEN_MINUTES, 30),
      betterAuthSecret: nonEmpty(env.BETTER_AUTH_SECRET) ?? nonEmpty(env.AUTH_SECRET) ?? 'dev-better-auth-secret-change-me',
      betterAuthUrl: nonEmpty(env.BETTER_AUTH_URL),
      organizationId: nonEmpty(env.AUTH_ORG_ID) ?? 'default-org',
      organizationName: nonEmpty(env.AUTH_ORG_NAME) ?? 'Slidev Agent',
      organizationSlug: normalizeSlug(nonEmpty(env.AUTH_ORG_SLUG) ?? 'default'),
    },
  };

  function parsePort(value: string | undefined): number {
    return parsePortValue(value, 4321, 'PORT');
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeDomain(value: string | undefined): string | undefined {
  const trimmed = nonEmpty(value);
  if (!trimmed) return undefined;
  return trimmed.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
}

function normalizeSlug(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'default';
}

function awaitableExists(dir: string): boolean {
  return existsSync(dir);
}

function smtpConfig(env: NodeJS.ProcessEnv) {
  if (!env.SMTP_HOST) return undefined;
  return {
    host: env.SMTP_HOST,
    port: parsePositiveInt(env.SMTP_PORT, 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM ?? 'Slidev Agent <no-reply@localhost>',
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid positive integer value: ${value}`);
  }
  return parsed;
}

function parsePortValue(value: string | undefined, fallback: number, label: string): number {
  if (!value) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${label} value: ${value}`);
  }
  return port;
}

/**
 * Returns the bundled static fallback when the configured web directory does not exist.
 */
export function fallbackStaticDir(config: AppConfig): string {
  return path.join(config.repoRoot, 'apps', 'server', 'public');
}
