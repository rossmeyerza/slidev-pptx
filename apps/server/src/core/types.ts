export type DeckVisibility = 'private' | 'shared' | 'published';

export interface DeckMeta {
  id: string;
  orgId?: string;
  title: string;
  scaffoldKey?: string;
  ownerUserId?: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
  visibility: DeckVisibility;
  draftUrl: string;
  shareToken?: string;
  activeEditorUserId?: string;
  publishedAt?: string;
  publishUrl?: string;
  messages?: ChatMessage[];
  agent?: DeckAgentSettings;
  pptx?: {
    id: string;
    status: ExportStatus;
    downloadUrl?: string;
    error?: string;
    updatedAt?: string;
    verification?: ExportJob['verification'];
  };
}

export interface DeckAgentSettings {
  baseUrl?: string;
  memberModel?: string;
  adminModel?: string;
  timeoutMs?: number;
}

export interface ChatMessage {
  role: 'user' | 'agent';
  content: string;
  createdAt: string;
}

export interface DeckRecord {
  meta: DeckMeta;
  markdown: string;
}

export interface ScaffoldRecord {
  key: string;
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
  minRole: UserRole;
}

export interface ShareRecord {
  id: string;
  token: string;
  deckId: string;
  name: string;
  email: string;
  permission: 'view' | 'edit';
  createdAt: string;
  enabled: boolean;
  url: string;
  hasPassword?: boolean;
}

export interface ShareVisitorRecord {
  id: string;
  shareToken: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface PublishRecord {
  id: string;
  deckId: string;
  channel: string;
  createdAt: string;
  url: string;
}

export interface DeckCollaboratorRecord {
  id: string;
  deckId: string;
  userId: string;
  role: 'editor' | 'viewer';
  createdAt: string;
}

export type ExportFormat = 'pptx' | 'markdown';
export type ExportStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ExportJob {
  id: string;
  deckId: string;
  format: ExportFormat;
  status: ExportStatus;
  createdAt: string;
  updatedAt: string;
  mode?: string;
  verification?: {
    ok: boolean;
    slideCount: number;
    imageCount: number;
  };
  outputPath?: string;
  downloadUrl?: string;
  error?: string;
}

export type AgentRunStatus = 'running' | 'done' | 'canceled' | 'error';

export interface AgentRunRecord {
  id: string;
  deckId: string;
  threadId: string;
  status: AgentRunStatus;
  model: string;
  roleScope: 'admin' | 'member';
  startedAt: string;
  endedAt?: string;
  error?: string;
}

export interface AppConfig {
  repoRoot: string;
  appRoot: string;
  dataDir: string;
  decksDir: string;
  staticDir: string;
  scaffoldKey: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  appDomain?: string;
  decksDomain?: string;
  export: ExportConfig;
  import: ImportConfig;
  agent: AgentConfig;
  database: DatabaseConfig;
  smtp?: SmtpConfig;
  auth: AuthConfig;
}

export interface ExportConfig {
  concurrency: number;
  timeoutMs: number;
}

export interface ImportConfig {
  timeoutMs: number;
}

export interface AgentConfig {
  baseUrl: string;
  apiKey?: string;
  memberModel: string;
  adminModel: string;
  timeoutMs: number;
}

export interface DatabaseConfig {
  url?: string;
  migrationsDir: string;
  ssl: boolean;
  langgraphSchema: string;
}

export type UserRole = 'admin' | 'employee';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'invited' | 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface AuthTokenRecord {
  id: string;
  tokenHash: string;
  email: string;
  purpose: 'login' | 'invite';
  role?: UserRole;
  name?: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  createdByUserId?: string;
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export interface AuthConfig {
  bypass: boolean;
  bootstrapAdminEmail?: string;
  bootstrapAdminName: string;
  sessionDays: number;
  tokenMinutes: number;
  betterAuthSecret: string;
  betterAuthUrl?: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
}
