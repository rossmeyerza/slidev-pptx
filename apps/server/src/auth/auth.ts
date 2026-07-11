import crypto, { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { JsonRequest } from '../core/http.js';
import type { AppConfig, AuthTokenRecord, SessionRecord, UserRecord, UserRole } from '../core/types.js';
import { readJson, writeJson } from '../core/storage.js';
import { Mailer } from './mailer.js';
import type { PgPool } from '../db/db.js';

export interface AuthContext {
  user: UserRecord;
  session: SessionRecord;
}

interface AuthFiles {
  users: string;
  tokens: string;
  sessions: string;
}

export class AuthService {
  private readonly files: AuthFiles;
  private readonly mailer: Mailer;

  constructor(
    private readonly config: AppConfig,
    private readonly pool: PgPool | null = null,
  ) {
    const authDir = path.join(config.dataDir, 'auth');
    this.files = {
      users: path.join(authDir, 'users.json'),
      tokens: path.join(authDir, 'tokens.json'),
      sessions: path.join(authDir, 'sessions.json'),
    };
    this.mailer = new Mailer(config);
  }

  async bootstrap(): Promise<void> {
    const users = await this.readUsers();
    if (users.length || !this.config.auth.bootstrapAdminEmail) return;

    const now = new Date().toISOString();
    const admin: UserRecord = {
      id: randomUUID(),
      email: normalizeEmail(this.config.auth.bootstrapAdminEmail),
      name: this.config.auth.bootstrapAdminName,
      role: 'admin',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.writeUsers([admin]);
  }

  async currentUser(req: JsonRequest): Promise<AuthContext | null> {
    if (this.config.auth.bypass) return this.bypassContext();

    const cookieHeader = req.headers.cookie ?? '';
    const token = readCookie(cookieHeader, 'slidev_session');

    if (token) {
      if (this.pool) {
        const context = await this.currentDbUser(token);
        if (context) return context;
      } else {
        const context = await this.currentJsonUser(token);
        if (context) return context;
      }
    }

    if (!this.pool) return null;
    const betterAuthToken = await this.readBetterAuthSessionToken(cookieHeader);
    if (!betterAuthToken) return null;
    return this.currentDbUser(betterAuthToken);
  }

  async requireUser(req: JsonRequest): Promise<AuthContext> {
    const context = await this.currentUser(req);
    if (!context) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
    return context;
  }

  async requireAdmin(req: JsonRequest): Promise<AuthContext> {
    const context = await this.requireUser(req);
    if (context.user.role !== 'admin') throw Object.assign(new Error('Admin role required'), { statusCode: 403 });
    return context;
  }

  private bypassContext(): AuthContext {
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: 'dev-auth-bypass-admin',
      email: normalizeEmail(this.config.auth.bootstrapAdminEmail ?? 'dev-admin@localhost.test'),
      name: this.config.auth.bootstrapAdminName || 'Dev Admin',
      role: 'admin',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };
    const session: SessionRecord = {
      id: 'dev-auth-bypass-session',
      tokenHash: 'dev-auth-bypass',
      userId: user.id,
      createdAt: now,
      expiresAt: expiresInMinutes(this.config.auth.sessionDays * 24 * 60),
    };
    return { user, session };
  }

  async requestLogin(input: { email: string }): Promise<{ sent: boolean; loginUrl?: string; devMessage?: unknown; deliveryError?: string }> {
    const email = normalizeEmail(input.email);
    const users = await this.readUsers();
    const user = users.find((candidate) => candidate.email === email && candidate.status !== 'disabled');
    if (!user) throw Object.assign(new Error('No active user exists for that email'), { statusCode: 404 });

    const { rawToken, record } = this.createToken({ email, purpose: 'login' });
    await this.saveToken(record);
    const loginUrl = this.urlForToken(rawToken);
    const result = await this.mailer.send(loginEmail(email, loginUrl));
    return {
      sent: result.sent,
      loginUrl: !result.sent && this.config.auth.devLink ? loginUrl : undefined,
      devMessage: this.config.auth.devLink ? result.devMessage : undefined,
      deliveryError: result.deliveryError,
    };
  }

  async inviteUser(input: { email: string; name?: string; role: UserRole; createdByUserId: string }) {
    const email = normalizeEmail(input.email);
    const users = await this.readUsers();
    const now = new Date().toISOString();
    let user = users.find((candidate) => candidate.email === email);

    if (user) {
      user = { ...user, name: input.name?.trim() || user.name, role: input.role, status: user.status === 'disabled' ? 'invited' : user.status, updatedAt: now };
      await this.writeUsers(users.map((candidate) => candidate.id === user?.id ? user : candidate));
    } else {
      user = {
        id: randomUUID(),
        email,
        name: input.name?.trim() || email,
        role: input.role,
        status: 'invited',
        createdAt: now,
        updatedAt: now,
      };
      await this.writeUsers([user, ...users]);
    }

    const { rawToken, record } = this.createToken({
      email,
      purpose: 'invite',
      role: input.role,
      name: user.name,
      createdByUserId: input.createdByUserId,
    });
    await this.saveToken(record);
    const inviteUrl = this.urlForToken(rawToken);
    const result = await this.mailer.send(inviteEmail(email, inviteUrl, input.role));
    return { user, sent: result.sent, inviteUrl: result.sent ? undefined : inviteUrl, devMessage: result.devMessage, deliveryError: result.deliveryError };
  }

  async consumeToken(rawToken: string): Promise<{ sessionToken: string; session: SessionRecord; user: UserRecord }> {
    const token = await this.consumeStoredToken(rawToken);

    const users = await this.readUsers();
    const now = new Date().toISOString();
    let user = users.find((candidate) => candidate.email === normalizeEmail(token.email));
    if (!user && token.purpose === 'invite') {
      user = {
        id: randomUUID(),
        email: normalizeEmail(token.email),
        name: token.name || token.email,
        role: token.role ?? 'employee',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      users.unshift(user);
    }
    if (!user || user.status === 'disabled') throw Object.assign(new Error('User is disabled'), { statusCode: 403 });

    user = { ...user, status: 'active', lastLoginAt: now, updatedAt: now };
    await this.writeUsers(users.map((candidate) => candidate.id === user?.id ? user : candidate));

    const sessionToken = randomToken();
    const session: SessionRecord = {
      id: randomUUID(),
      tokenHash: hashToken(sessionToken),
      userId: user.id,
      createdAt: now,
      expiresAt: expiresInMinutes(this.config.auth.sessionDays * 24 * 60),
    };
    await this.saveSession(session, sessionToken);
    return { sessionToken, session, user };
  }

  async logout(req: JsonRequest): Promise<void> {
    const cookieHeader = req.headers.cookie ?? '';
    const token = readCookie(cookieHeader, 'slidev_session');
    const betterAuthToken = this.pool ? await this.readBetterAuthSessionToken(cookieHeader) : undefined;
    if (this.pool) {
      await this.pool.query(
        'delete from "session" where "token" = any($1::text[])',
        [[token ? hashToken(token) : '', betterAuthToken ?? ''].filter(Boolean)],
      );
      return;
    }
    if (!token) return;
    const sessions = await this.readSessions();
    await writeJson(this.files.sessions, sessions.filter((candidate) => !compareHash(candidate.tokenHash, token)));
  }

  async listUsers(): Promise<UserRecord[]> {
    return this.readUsers();
  }

  async updateUser(
    userId: string,
    input: { name?: string; role?: UserRole; status?: UserRecord['status'] },
  ): Promise<UserRecord> {
    const users = await this.readUsers();
    const existing = users.find((candidate) => candidate.id === userId);
    if (!existing) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const now = new Date().toISOString();
    const updated: UserRecord = {
      ...existing,
      name: input.name?.trim() || existing.name,
      role: input.role ?? existing.role,
      status: input.status ?? existing.status,
      updatedAt: now,
    };
    const nextUsers = users.map((candidate) => candidate.id === userId ? updated : candidate);
    const activeAdmins = nextUsers.filter((candidate) => candidate.role === 'admin' && candidate.status !== 'disabled');
    if (!activeAdmins.length) {
      throw Object.assign(new Error('At least one active admin is required'), { statusCode: 400 });
    }

    await this.writeUsers(nextUsers);
    if (updated.status === 'disabled') await this.deleteSessionsForUser(updated.id);
    return updated;
  }

  async sessionCookie(sessionToken: string, session: SessionRecord): Promise<string[]> {
    const maxAge = Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));
    const cookies = [`slidev_session=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`];
    if (this.pool) {
      cookies.push(`better-auth.session_token=${encodeURIComponent(await signBetterAuthCookieValue(sessionToken, this.config.auth.betterAuthSecret))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
    }
    return cookies;
  }

  clearCookie(): string[] {
    return [
      'slidev_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      'better-auth.session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      '__Secure-better-auth.session_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    ];
  }

  private createToken(input: Omit<AuthTokenRecord, 'id' | 'tokenHash' | 'createdAt' | 'expiresAt'>): { rawToken: string; record: AuthTokenRecord } {
    const rawToken = randomToken();
    const now = new Date().toISOString();
    return {
      rawToken,
      record: {
        id: randomUUID(),
        tokenHash: hashToken(rawToken),
        createdAt: now,
        expiresAt: expiresInMinutes(this.config.auth.tokenMinutes),
        ...input,
      },
    };
  }

  private async saveToken(record: AuthTokenRecord): Promise<void> {
    if (this.pool) {
      await this.pool.query(
        `
          insert into app_auth_token (
            id, token_hash, email, purpose, app_role, display_name, created_at, expires_at, used_at, created_by_user_id
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
          )
        `,
        [
          record.id,
          record.tokenHash,
          record.email,
          record.purpose,
          record.role ?? null,
          record.name ?? null,
          record.createdAt,
          record.expiresAt,
          record.usedAt ?? null,
          record.createdByUserId ?? null,
        ],
      );
      return;
    }
    const tokens = (await this.readTokens()).filter((candidate) => !candidate.usedAt && !isExpired(candidate.expiresAt));
    await writeJson(this.files.tokens, [record, ...tokens]);
  }

  private urlForToken(rawToken: string): string {
    return `${this.config.publicBaseUrl}/auth/callback?token=${encodeURIComponent(rawToken)}`;
  }

  private async readUsers(): Promise<UserRecord[]> {
    if (this.pool) return this.readDbUsers();
    return readJson<UserRecord[]>(this.files.users, []);
  }

  private readTokens(): Promise<AuthTokenRecord[]> {
    return readJson<AuthTokenRecord[]>(this.files.tokens, []);
  }

  private readSessions(): Promise<SessionRecord[]> {
    return readJson<SessionRecord[]>(this.files.sessions, []);
  }

  private async writeUsers(users: UserRecord[]): Promise<void> {
    if (!this.pool) {
      await writeJson(this.files.users, users);
      return;
    }
    for (const user of users) await this.upsertDbUser(user);
  }

  private async deleteSessionsForUser(userId: string): Promise<void> {
    if (this.pool) {
      await this.pool.query('delete from "session" where "userId" = $1', [userId]);
      return;
    }
    const sessions = await this.readSessions();
    await writeJson(this.files.sessions, sessions.filter((candidate) => candidate.userId !== userId));
  }

  private async currentJsonUser(token: string): Promise<AuthContext | null> {
    const sessions = await this.readSessions();
    const session = sessions.find((candidate) => (
      !isExpired(candidate.expiresAt) && compareHash(candidate.tokenHash, token)
    ));
    if (!session) return null;

    const user = (await this.readUsers()).find((candidate) => candidate.id === session.userId && candidate.status !== 'disabled');
    if (!user) return null;
    return { user, session };
  }

  private async currentDbUser(token: string): Promise<AuthContext | null> {
    if (!this.pool) return null;
    const result = await this.pool.query(
      `
        select
          s.id as session_id,
          s."token" as token_hash,
          s."userId" as user_id,
          s."createdAt" as session_created_at,
          s."expiresAt" as expires_at,
          u.id,
          u.email,
          u.name,
          u."createdAt" as user_created_at,
          u."updatedAt" as user_updated_at,
          u.banned,
          p.app_role,
          p.status,
          p.last_login_at
        from "session" s
        join "user" u on u.id = s."userId"
        join app_user_profile p on p.user_id = u.id
        where s."token" = any($1::text[]) and s."expiresAt" > now()
        limit 1
      `,
      [[token, hashToken(token)]],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    if (row.banned || row.status === 'disabled') return null;
    return {
      user: rowToUser(row),
      session: {
        id: String(row.session_id),
        tokenHash: String(row.token_hash),
        userId: String(row.user_id),
        createdAt: iso(row.session_created_at),
        expiresAt: iso(row.expires_at),
      },
    };
  }

  private async readDbUsers(): Promise<UserRecord[]> {
    if (!this.pool) return [];
    const result = await this.pool.query(
      `
        select
          u.id,
          u.email,
          u.name,
          u."createdAt" as user_created_at,
          u."updatedAt" as user_updated_at,
          u.banned,
          p.app_role,
          p.status,
          p.last_login_at
        from "user" u
        join app_user_profile p on p.user_id = u.id
        order by u."createdAt" desc
      `,
    );
    return result.rows.map(rowToUser);
  }

  private async upsertDbUser(user: UserRecord): Promise<void> {
    if (!this.pool) return;
    await this.ensureDefaultOrganization();
    await this.pool.query(
      `
        insert into "user" (
          id, "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned"
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
        on conflict (id) do update set
          "name" = excluded."name",
          "email" = excluded."email",
          "updatedAt" = excluded."updatedAt",
          "role" = excluded."role",
          "banned" = excluded."banned"
      `,
      [
        user.id,
        user.name,
        user.email,
        user.status === 'active',
        user.createdAt,
        user.updatedAt,
        user.role === 'admin' ? 'admin' : 'user',
        user.status === 'disabled',
      ],
    );
    await this.pool.query(
      `
        insert into app_user_profile (
          user_id, app_role, status, last_login_at, created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5, $6
        )
        on conflict (user_id) do update set
          app_role = excluded.app_role,
          status = excluded.status,
          last_login_at = excluded.last_login_at,
          updated_at = excluded.updated_at
      `,
      [
        user.id,
        user.role,
        user.status,
        user.lastLoginAt ?? null,
        user.createdAt,
        user.updatedAt,
      ],
    );
    await this.upsertOrganizationMember(user);
  }

  private async ensureDefaultOrganization(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `
        insert into "organization" (
          id, "name", "slug", "createdAt"
        ) values (
          $1, $2, $3, now()
        )
        on conflict (id) do update set
          "name" = excluded."name",
          "slug" = excluded."slug"
      `,
      [
        this.config.auth.organizationId,
        this.config.auth.organizationName,
        this.config.auth.organizationSlug,
      ],
    );
  }

  private async upsertOrganizationMember(user: UserRecord): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `
        insert into "member" (
          id, "organizationId", "userId", "role", "createdAt"
        ) values (
          $1, $2, $3, $4, now()
        )
        on conflict (id) do update set
          "role" = excluded."role"
      `,
      [
        `${this.config.auth.organizationId}:${user.id}`,
        this.config.auth.organizationId,
        user.id,
        user.role === 'admin' ? 'admin' : 'member',
      ],
    );
  }

  private async consumeStoredToken(rawToken: string): Promise<AuthTokenRecord> {
    if (!this.pool) {
      const tokens = await this.readTokens();
      const token = tokens.find((candidate) => !candidate.usedAt && !isExpired(candidate.expiresAt) && compareHash(candidate.tokenHash, rawToken));
      if (!token) throw Object.assign(new Error('Login link is invalid or expired'), { statusCode: 401 });
      const now = new Date().toISOString();
      await writeJson(this.files.tokens, tokens.map((candidate) => candidate.id === token.id ? { ...candidate, usedAt: now } : candidate));
      return token;
    }

    const tokenHash = hashToken(rawToken);
    const result = await this.pool.query(
      `
        update app_auth_token
        set used_at = now()
        where token_hash = $1 and used_at is null and expires_at > now()
        returning *
      `,
      [tokenHash],
    );
    if (!result.rowCount) throw Object.assign(new Error('Login link is invalid or expired'), { statusCode: 401 });
    return rowToToken(result.rows[0]);
  }

  private async saveSession(session: SessionRecord, rawToken?: string): Promise<void> {
    if (!this.pool) {
      const sessions = (await this.readSessions()).filter((candidate) => !isExpired(candidate.expiresAt));
      await writeJson(this.files.sessions, [session, ...sessions]);
      return;
    }
    await this.pool.query(
      `
        delete from "session"
        where "expiresAt" <= now() or "userId" = $1
      `,
      [session.userId],
    );
	    await this.pool.query(
	      `
	        insert into "session" (
	          id, "expiresAt", "token", "createdAt", "updatedAt", "userId", "activeOrganizationId"
	        ) values (
	          $1, $2, $3, $4, $5, $6, $7
	        )
	      `,
		      [
		        session.id,
		        session.expiresAt,
		        rawToken ?? session.tokenHash,
		        session.createdAt,
		        session.createdAt,
		        session.userId,
		        this.config.auth.organizationId,
	      ],
	    );
  }

  private async readBetterAuthSessionToken(cookieHeader: string): Promise<string | undefined> {
    const signed = readCookie(cookieHeader, 'better-auth.session_token')
      ?? readCookie(cookieHeader, '__Secure-better-auth.session_token')
      ?? readCookie(cookieHeader, 'better-auth-session_token')
      ?? readCookie(cookieHeader, '__Secure-better-auth-session_token');
    if (!signed) return undefined;
    return verifyBetterAuthCookieValue(signed, this.config.auth.betterAuthSecret);
  }
}

function loginEmail(to: string, url: string) {
  return {
    to,
    subject: 'Sign in to Deckhand',
    text: `Use this one-time link to sign in: ${url}`,
    html: `<p>Use this one-time link to sign in:</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
  };
}

function inviteEmail(to: string, url: string, role: UserRole) {
  return {
    to,
    subject: 'You have been invited to Deckhand',
    text: `You have been invited as ${role}. Use this one-time link to accept: ${url}`,
    html: `<p>You have been invited as <strong>${role}</strong>.</p><p><a href="${escapeHtml(url)}">Accept invite</a></p>`,
  };
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw Object.assign(new Error('Valid email is required'), { statusCode: 400 });
  }
  return normalized;
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function compareHash(hash: string, rawToken: string): boolean {
  const candidate = hashToken(rawToken);
  const left = Buffer.from(hash);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function signBetterAuthCookieValue(value: string, secret: string): Promise<string> {
  return `${value}.${await betterAuthSignature(value, secret)}`;
}

async function verifyBetterAuthCookieValue(signed: string, secret: string): Promise<string | undefined> {
  const separator = signed.lastIndexOf('.');
  if (separator <= 0) return undefined;
  const value = signed.slice(0, separator);
  const signature = signed.slice(separator + 1);
  const expected = await betterAuthSignature(value, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return undefined;
  return value;
}

async function betterAuthSignature(value: string, secret: string): Promise<string> {
  return crypto.createHmac('sha256', secret).update(value).digest('base64');
}

function expiresInMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function isExpired(value: string): boolean {
  return Date.parse(value) <= Date.now();
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: row.app_role === 'admin' ? 'admin' : 'employee',
    status: row.status === 'disabled' ? 'disabled' : row.status === 'invited' ? 'invited' : 'active',
    createdAt: iso(row.user_created_at),
    updatedAt: iso(row.user_updated_at),
    lastLoginAt: row.last_login_at ? iso(row.last_login_at) : undefined,
  };
}

function rowToToken(row: Record<string, unknown>): AuthTokenRecord {
  return {
    id: String(row.id),
    tokenHash: String(row.token_hash),
    email: String(row.email),
    purpose: row.purpose === 'invite' ? 'invite' : 'login',
    role: row.app_role === 'admin' ? 'admin' : row.app_role === 'employee' ? 'employee' : undefined,
    name: typeof row.display_name === 'string' ? row.display_name : undefined,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    usedAt: row.used_at ? iso(row.used_at) : undefined,
    createdByUserId: typeof row.created_by_user_id === 'string' ? row.created_by_user_id : undefined,
  };
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char));
}
