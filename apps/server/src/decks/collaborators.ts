import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, DeckCollaboratorRecord } from '../core/types.js';
import type { PgPool } from '../db/db.js';
import { readJson, writeJson } from '../core/storage.js';

/**
 * Stores deck collaborators in Postgres when available, with a JSON fallback for local development.
 */
export class CollaboratorService {
  private readonly filePath: string;

  constructor(
    private readonly config: AppConfig,
    private readonly pool: PgPool | null = null,
  ) {
    this.filePath = path.join(config.dataDir, 'collaborators.json');
  }

  async list(deckId: string): Promise<DeckCollaboratorRecord[]> {
    if (this.pool) {
      const result = await this.pool.query(
        'select id, deck_id, user_id, role, created_at from deck_collaborator where deck_id = $1 order by created_at desc',
        [deckId],
      );
      return result.rows.map(rowToCollaborator);
    }
    return (await this.readAll()).filter((record) => record.deckId === deckId);
  }

  async upsert(input: { deckId: string; userId: string; role: 'editor' | 'viewer' }): Promise<DeckCollaboratorRecord> {
    if (this.pool) {
      const deck = await this.pool.query('select org_id from deck where id = $1', [input.deckId]);
      if (!deck.rowCount) throw Object.assign(new Error('Deck not found'), { statusCode: 404 });
      const result = await this.pool.query(
        `
          insert into deck_collaborator(id, org_id, deck_id, user_id, role)
          values ($1, $2, $3, $4, $5)
          on conflict (deck_id, user_id) do update set role = excluded.role
          returning id, deck_id, user_id, role, created_at
        `,
        [randomUUID(), deck.rows[0].org_id, input.deckId, input.userId, input.role],
      );
      return rowToCollaborator(result.rows[0]);
    }

    const records = await this.readAll();
    const existing = records.find((record) => record.deckId === input.deckId && record.userId === input.userId);
    const next: DeckCollaboratorRecord = {
      id: existing?.id ?? randomUUID(),
      deckId: input.deckId,
      userId: input.userId,
      role: input.role,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    await writeJson(this.filePath, [next, ...records.filter((record) => record.id !== next.id)]);
    return next;
  }

  async remove(deckId: string, userId: string): Promise<void> {
    if (this.pool) {
      await this.pool.query('delete from deck_collaborator where deck_id = $1 and user_id = $2', [deckId, userId]);
      return;
    }
    const records = await this.readAll();
    await writeJson(this.filePath, records.filter((record) => !(record.deckId === deckId && record.userId === userId)));
  }

  async roleFor(deckId: string, userId: string): Promise<'editor' | 'viewer' | undefined> {
    return (await this.list(deckId)).find((record) => record.userId === userId)?.role;
  }

  private readAll(): Promise<DeckCollaboratorRecord[]> {
    return readJson<DeckCollaboratorRecord[]>(this.filePath, []);
  }
}

function rowToCollaborator(row: Record<string, unknown>): DeckCollaboratorRecord {
  return {
    id: String(row.id),
    deckId: String(row.deck_id),
    userId: String(row.user_id),
    role: row.role === 'viewer' ? 'viewer' : 'editor',
    createdAt: iso(row.created_at),
  };
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
