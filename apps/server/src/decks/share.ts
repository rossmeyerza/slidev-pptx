import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { AppConfig, PublishRecord, ShareRecord, ShareVisitorRecord } from '../core/types.js';
import { readJson, writeJson } from '../core/storage.js';
import { DeckStore } from './decks.js';
import type { PgPool } from '../db/db.js';

/**
 * Manages public share tokens and local publish records.
 */
export class ShareService {
  private readonly sharesPath: string;
  private readonly visitorsPath: string;
  private readonly publishPath: string;

  constructor(
    private readonly config: AppConfig,
    private readonly decks: DeckStore,
    private readonly pool: PgPool | null = null,
  ) {
    this.sharesPath = path.join(config.dataDir, 'shares.json');
    this.visitorsPath = path.join(config.dataDir, 'share-visitors.json');
    this.publishPath = path.join(config.dataDir, 'publishes.json');
  }

  /**
   * Creates a client share token for a deck.
   */
  async share(deckId: string, input: { name?: string; email?: string; permission?: 'view' | 'edit'; password?: string; enabled?: boolean; createdByUserId?: string; expiresInDays?: number }): Promise<ShareRecord> {
    await this.decks.get(deckId);
    const token = randomBytes(18).toString('base64url');
    const password = clean(input.password);
    const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
    const record: ShareRecord = {
      id: randomUUID(),
      token,
      deckId,
      name: clean(input.name) ?? 'Client',
      email: clean(input.email) ?? '',
      permission: input.permission ?? 'view',
      createdAt: new Date().toISOString(),
      enabled: input.enabled ?? true,
      url: `/share/${token}/#/1`,
      hasPassword: Boolean(passwordHash),
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() : undefined,
      viewCount: 0,
    };

    if (this.pool) await this.insertShare(record, input.createdByUserId ?? 'system', passwordHash);
    else {
      const shares = await this.readShares();
      await writeJson(this.sharesPath, [{ ...record, passwordHash }, ...shares]);
    }
    await this.decks.updateMeta(deckId, {
      visibility: record.enabled ? 'shared' : 'private',
      shareToken: record.enabled ? record.token : undefined,
    });
    return record;
  }

  /**
   * Lists enabled share tokens for a deck.
   */
  async sharesForDeck(deckId: string): Promise<ShareRecord[]> {
    if (this.pool) {
      const result = await this.pool.query(
        'select * from share_link where deck_id = $1 and revoked_at is null and (expires_at is null or expires_at > now()) order by created_at desc',
        [deckId],
      );
      return result.rows.map(rowToShare);
    }
    const shares = await this.readShares();
    return shares.filter((share) => share.deckId === deckId && share.enabled && (!share.expiresAt || Date.parse(share.expiresAt) > Date.now())).map(sanitizeShare);
  }

  /**
   * Resolves a public share token to its share record.
   */
  async getShare(token: string): Promise<ShareRecord> {
    if (this.pool) {
      const result = await this.pool.query(
        'select * from share_link where token = $1 and revoked_at is null and (expires_at is null or expires_at > now())',
        [token],
      );
      if (!result.rowCount) throw Object.assign(new Error('Share not found'), { statusCode: 404 });
      return rowToShare(result.rows[0]);
    }
    const shares = await this.readShares();
    const share = shares.find((candidate) => candidate.token === token && candidate.enabled && (!candidate.expiresAt || Date.parse(candidate.expiresAt) > Date.now()));
    if (!share) throw Object.assign(new Error('Share not found'), { statusCode: 404 });
    return sanitizeShare(share);
  }

  /**
   * Checks whether a public share token requires a password and whether the
   * caller has already satisfied it.
   */
  async isPasswordSatisfied(token: string, cookieValue: string | undefined): Promise<boolean> {
    const share = await this.getShare(token);
    if (!share.hasPassword) return true;
    return cookieValue === await this.passwordCookieValue(share);
  }

  /**
   * Verifies a share-link password and returns the cookie value to store.
   */
  async verifyPassword(token: string, password: string | undefined): Promise<string> {
    const share = await this.getShare(token);
    if (!share.hasPassword) return this.passwordCookieValue(share);
    const candidate = clean(password);
    if (!candidate) throw Object.assign(new Error('Password is required'), { statusCode: 400 });
    const hash = await this.passwordHashForShare(share);
    if (!hash || !(await bcrypt.compare(candidate, hash))) {
      throw Object.assign(new Error('Incorrect share password'), { statusCode: 403 });
    }
    return this.passwordCookieValue(share);
  }

  /**
   * Revokes an existing share token.
   */
  async revoke(deckId: string, shareId: string): Promise<void> {
    await this.decks.get(deckId);
    if (this.pool) {
      const result = await this.pool.query(
        'update share_link set revoked_at = now() where id = $1 and deck_id = $2 and revoked_at is null',
        [shareId, deckId],
      );
      if (!result.rowCount) throw Object.assign(new Error('Share not found'), { statusCode: 404 });
    } else {
      const shares = await this.readShares();
      const index = shares.findIndex((share) => share.id === shareId && share.deckId === deckId && share.enabled);
      if (index < 0) throw Object.assign(new Error('Share not found'), { statusCode: 404 });
      shares[index] = { ...shares[index], enabled: false };
      await writeJson(this.sharesPath, shares);
    }

    const remaining = await this.sharesForDeck(deckId);
    if (!remaining.length) {
      await this.decks.updateMeta(deckId, { visibility: 'private', shareToken: undefined });
    }
  }

  async shareForDeckById(deckId: string, shareId: string): Promise<ShareRecord> {
    if (this.pool) {
      const result = await this.pool.query('select * from share_link where id = $1 and deck_id = $2 and revoked_at is null and (expires_at is null or expires_at > now())', [shareId, deckId]);
      if (!result.rowCount) throw Object.assign(new Error('Share not found'), { statusCode: 404 });
      return rowToShare(result.rows[0]);
    }
    const share = (await this.readShares()).find((candidate) => candidate.id === shareId && candidate.deckId === deckId && candidate.enabled && (!candidate.expiresAt || Date.parse(candidate.expiresAt) > Date.now()));
    if (!share) throw Object.assign(new Error('Share not found'), { statusCode: 404 });
    return sanitizeShare(share);
  }

  async recordView(token: string): Promise<ShareRecord> {
    const share = await this.getShare(token);
    const now = new Date().toISOString();
    if (this.pool) {
      const result = await this.pool.query(
        'update share_link set view_count = view_count + 1, last_viewed_at = now() where id = $1 returning *',
        [share.id],
      );
      return rowToShare(result.rows[0]);
    }
    const shares = await this.readShares();
    const index = shares.findIndex((candidate) => candidate.id === share.id);
    shares[index] = { ...shares[index], viewCount: (shares[index].viewCount ?? 0) + 1, lastViewedAt: now };
    await writeJson(this.sharesPath, shares);
    return sanitizeShare(shares[index]);
  }

  async visitorsForShare(token: string): Promise<ShareVisitorRecord[]> {
    const share = await this.getShare(token);
    if (this.pool) {
      const result = await this.pool.query(
        'select * from share_visitor where share_link_id = $1 order by created_at desc',
        [share.id],
      );
      return result.rows.map((row) => rowToVisitor(row, share.token));
    }
    return (await this.readVisitors()).filter((visitor) => visitor.shareToken === share.token).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Records the actual anonymous visitor opening an edit-capable share link.
   */
  async identifyVisitor(token: string, input: { name?: string; email?: string }): Promise<ShareVisitorRecord> {
    const share = await this.getShare(token);
    const name = clean(input.name);
    const email = clean(input.email);
    if (!name) throw Object.assign(new Error('Name is required'), { statusCode: 400 });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error('Valid email is required'), { statusCode: 400 });
    }

    const visitor: ShareVisitorRecord = {
      id: randomUUID(),
      shareToken: share.token,
      name,
      email: email.toLowerCase(),
      createdAt: new Date().toISOString(),
    };

    if (this.pool) await this.insertVisitor(share, visitor);
    else {
      const visitors = await this.readVisitors();
      await writeJson(this.visitorsPath, [visitor, ...visitors]);
    }
    return visitor;
  }

  /**
   * Finds a previously identified visitor for a share-token cookie.
   */
  async visitorForShare(token: string, visitorId: string | undefined): Promise<ShareVisitorRecord | null> {
    if (!visitorId) return null;
    const share = await this.getShare(token);
    if (this.pool) {
      const result = await this.pool.query(
        `
          select sv.*
          from share_visitor sv
          join share_link sl on sl.id = sv.share_link_id
          where sv.id = $1 and sl.token = $2
          limit 1
        `,
        [visitorId, share.token],
      );
      if (!result.rowCount) return null;
      return rowToVisitor(result.rows[0], share.token);
    }
    const visitors = await this.readVisitors();
    return visitors.find((visitor) => visitor.id === visitorId && visitor.shareToken === share.token) ?? null;
  }

  /**
   * Resolves a share token to a deck record.
   */
  async getSharedDeck(token: string) {
    const share = await this.getShare(token);
    return this.decks.get(share.deckId);
  }

  /**
   * Records a local publish event and marks the deck published.
   */
  async publish(deckId: string, channel = 'local'): Promise<PublishRecord> {
    await this.decks.get(deckId);
    const record: PublishRecord = {
      id: randomUUID(),
      deckId,
      channel: channel.trim() || 'local',
      createdAt: new Date().toISOString(),
      url: `/published/${deckId}/#/1`,
    };
    if (!this.pool) {
      const publishes = await readJson<PublishRecord[]>(this.publishPath, []);
      await writeJson(this.publishPath, [record, ...publishes]);
    }
    await this.decks.updateMeta(deckId, {
      status: 'published',
      visibility: 'published',
      publishedAt: record.createdAt,
      publishUrl: record.url,
    });
    return record;
  }

  private readShares(): Promise<ShareRecord[]> {
    return readJson<ShareRecord[]>(this.sharesPath, []);
  }

  private readVisitors(): Promise<ShareVisitorRecord[]> {
    return readJson<ShareVisitorRecord[]>(this.visitorsPath, []);
  }

  private async passwordCookieValue(share: ShareRecord): Promise<string> {
    const passwordHash = await this.passwordHashForShare(share);
    return createHash('sha256').update(`${share.id}:${share.token}:${share.createdAt}:${passwordHash ?? ''}`).digest('base64url');
  }

  private async passwordHashForShare(share: ShareRecord): Promise<string | undefined> {
    if (this.pool) {
      const result = await this.pool.query('select password_hash from share_link where id = $1', [share.id]);
      return typeof result.rows[0]?.password_hash === 'string' ? result.rows[0].password_hash : undefined;
    }
    const shares = await this.readShares();
    const match = shares.find((candidate) => candidate.id === share.id);
    return typeof (match as ShareRecord & { passwordHash?: unknown } | undefined)?.passwordHash === 'string'
      ? (match as ShareRecord & { passwordHash: string }).passwordHash
      : undefined;
  }

  private async insertShare(record: ShareRecord, createdByUserId: string, passwordHash?: string): Promise<void> {
    if (!this.pool) return;
    const deck = await this.pool.query('select org_id from deck where id = $1', [record.deckId]);
    if (!deck.rowCount) throw Object.assign(new Error('Deck not found'), { statusCode: 404 });
    await this.pool.query(
      `
        insert into share_link (
          id, org_id, deck_id, token, permission, password_hash, display_name, email, created_by, created_at, revoked_at, expires_at, view_count
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
      `,
      [
        record.id,
        deck.rows[0].org_id,
        record.deckId,
        record.token,
        record.permission,
        passwordHash ?? null,
        record.name,
        record.email,
        createdByUserId,
        record.createdAt,
        record.enabled ? null : record.createdAt,
        record.expiresAt ?? null,
        record.viewCount ?? 0,
      ],
    );
  }

  private async insertVisitor(share: ShareRecord, visitor: ShareVisitorRecord): Promise<void> {
    if (!this.pool) return;
    const link = await this.pool.query('select id, org_id from share_link where token = $1', [share.token]);
    if (!link.rowCount) throw Object.assign(new Error('Share not found'), { statusCode: 404 });
    await this.pool.query(
      `
        insert into share_visitor (
          id, org_id, share_link_id, display_name, email, created_at
        ) values (
          $1, $2, $3, $4, $5, $6
        )
      `,
      [
        visitor.id,
        link.rows[0].org_id,
        link.rows[0].id,
        visitor.name,
        visitor.email,
        visitor.createdAt,
      ],
    );
  }
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 240) : undefined;
}

function rowToShare(row: Record<string, unknown>): ShareRecord {
  const token = String(row.token);
  return {
    id: String(row.id),
    token,
    deckId: String(row.deck_id),
    name: typeof row.display_name === 'string' ? row.display_name : 'Client',
    email: typeof row.email === 'string' ? row.email : '',
    permission: row.permission === 'edit' ? 'edit' : 'view',
    createdAt: iso(row.created_at),
    enabled: !row.revoked_at,
    url: `/share/${token}/#/1`,
    hasPassword: typeof row.password_hash === 'string' && row.password_hash.length > 0,
    expiresAt: row.expires_at ? iso(row.expires_at) : undefined,
    viewCount: Number(row.view_count ?? 0),
    lastViewedAt: row.last_viewed_at ? iso(row.last_viewed_at) : undefined,
  };
}

function sanitizeShare(share: ShareRecord & { passwordHash?: unknown }): ShareRecord {
  const { passwordHash: _passwordHash, ...safe } = share;
  return {
    ...safe,
    hasPassword: Boolean(share.hasPassword || _passwordHash),
  };
}

function rowToVisitor(row: Record<string, unknown>, shareToken: string): ShareVisitorRecord {
  return {
    id: String(row.id),
    shareToken,
    name: typeof row.display_name === 'string' ? row.display_name : 'Client',
    email: typeof row.email === 'string' ? row.email : '',
    createdAt: iso(row.created_at),
  };
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
