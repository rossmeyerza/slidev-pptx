import path from 'node:path';
import type { AppConfig } from '../core/types.js';
import { readJson, writeJson } from '../core/storage.js';

export interface AppSettings {
  agent?: {
    baseUrl?: string;
    memberModel?: string;
    adminModel?: string;
    timeoutMs?: number;
  };
  scaffolds?: {
    defaultKey?: string;
    items?: Record<string, ScaffoldSettings>;
  };
}

export interface ScaffoldSettings {
  name?: string;
  description?: string;
  isActive?: boolean;
  minRole?: 'admin' | 'employee';
}

/**
 * Stores small runtime settings that admins can change without editing env.
 */
export class SettingsService {
  private readonly filePath: string;

  constructor(private readonly config: AppConfig) {
    this.filePath = path.join(config.dataDir, 'settings.json');
  }

  async load(): Promise<AppSettings> {
    return readJson<AppSettings>(this.filePath, {});
  }

  async apply(): Promise<AppSettings> {
    const settings = await this.load();
    applySettings(this.config, settings);
    return settings;
  }

  async update(input: AppSettings): Promise<AppSettings> {
    const current = await this.load();
    const next: AppSettings = {
      ...current,
      agent: {
        ...current.agent,
        ...normalizeAgentSettings(input.agent ?? {}),
      },
    };
    const scaffoldSettings = normalizeScaffoldSettings(input.scaffolds);
    if (scaffoldSettings) {
      next.scaffolds = {
        defaultKey: scaffoldSettings.defaultKey ?? current.scaffolds?.defaultKey,
        items: {
          ...(current.scaffolds?.items ?? {}),
          ...(scaffoldSettings.items ?? {}),
        },
      };
    }
    await writeJson(this.filePath, next);
    applySettings(this.config, next);
    return next;
  }
}

export function formatSettings(config: AppConfig, persisted: AppSettings = {}) {
  return {
    agent: {
      baseUrl: config.agent.baseUrl,
      memberModel: config.agent.memberModel,
      adminModel: config.agent.adminModel,
      timeoutMs: config.agent.timeoutMs,
      persisted: persisted.agent ?? {},
    },
    scaffolds: persisted.scaffolds ?? {},
    livePreview: {
      portPoolStart: config.livePreview.portPoolStart,
      portPoolEnd: config.livePreview.portPoolEnd,
      maxConcurrentDecks: config.livePreview.maxConcurrentDecks,
      deckIdleTimeoutMs: config.livePreview.deckIdleTimeoutMs,
      crashRetryLimit: config.livePreview.crashRetryLimit,
      crashRetryDelayMs: config.livePreview.crashRetryDelayMs,
    },
    export: {
      concurrency: config.export.concurrency,
      timeoutMs: config.export.timeoutMs,
    },
    import: {
      timeoutMs: config.import.timeoutMs,
    },
    database: {
      enabled: Boolean(config.database.url),
      langgraphSchema: config.database.langgraphSchema,
    },
    smtp: {
      enabled: Boolean(config.smtp),
      host: config.smtp?.host,
      port: config.smtp?.port,
      secure: config.smtp?.secure,
      from: config.smtp?.from,
    },
  };
}

function applySettings(config: AppConfig, settings: AppSettings): void {
  const agent = normalizeAgentSettings(settings.agent ?? {});
  if (agent.baseUrl) config.agent.baseUrl = agent.baseUrl;
  if (agent.memberModel) config.agent.memberModel = agent.memberModel;
  if (agent.adminModel) config.agent.adminModel = agent.adminModel;
  if (agent.timeoutMs) config.agent.timeoutMs = agent.timeoutMs;
  if (settings.scaffolds?.defaultKey) config.scaffoldKey = settings.scaffolds.defaultKey;
}

function normalizeAgentSettings(agent: AppSettings['agent']): NonNullable<AppSettings['agent']> {
  const next: NonNullable<AppSettings['agent']> = {};
  if (typeof agent?.baseUrl === 'string' && agent.baseUrl.trim()) next.baseUrl = agent.baseUrl.trim().replace(/\/$/, '');
  if (typeof agent?.memberModel === 'string' && agent.memberModel.trim()) next.memberModel = agent.memberModel.trim();
  if (typeof agent?.adminModel === 'string' && agent.adminModel.trim()) next.adminModel = agent.adminModel.trim();
  const timeoutMs = agent?.timeoutMs;
  if (Number.isInteger(timeoutMs) && Number(timeoutMs) > 0) next.timeoutMs = Number(timeoutMs);
  return next;
}

function normalizeScaffoldSettings(input: AppSettings['scaffolds']): AppSettings['scaffolds'] | undefined {
  if (!input) return undefined;
  const items: Record<string, ScaffoldSettings> = {};
  for (const [rawKey, rawValue] of Object.entries(input.items ?? {})) {
    const key = normalizeScaffoldKey(rawKey);
    if (!key || !rawValue || typeof rawValue !== 'object') continue;
    const value = rawValue as ScaffoldSettings;
    const next: ScaffoldSettings = {};
    if (typeof value.name === 'string') next.name = value.name.trim();
    if (typeof value.description === 'string') next.description = value.description.trim();
    if (typeof value.isActive === 'boolean') next.isActive = value.isActive;
    if (value.minRole === 'admin' || value.minRole === 'employee') next.minRole = value.minRole;
    items[key] = next;
  }
  const defaultKey = normalizeScaffoldKey(input.defaultKey);
  return {
    ...(defaultKey ? { defaultKey } : {}),
    ...(Object.keys(items).length ? { items } : {}),
  };
}

function normalizeScaffoldKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim();
  if (!key) return undefined;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(key)) return undefined;
  return key;
}
