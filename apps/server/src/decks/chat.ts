import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, ChatMessage } from '../core/types.js';
import type { PgPool } from '../db/db.js';
import { readJson, writeJson } from '../core/storage.js';

interface ChatFileRecord {
  deckId: string;
  messages: ChatMessage[];
}

/**
 * Stores per-deck chat history in Postgres when available, with JSON fallback for local smoke/dev.
 */
export class ChatService {
  private readonly filePath: string;

  constructor(
    private readonly config: AppConfig,
    private readonly pool: PgPool | null = null,
  ) {
    this.filePath = path.join(config.dataDir, 'chat.json');
  }

  async list(deckId: string): Promise<ChatMessage[]> {
    if (this.pool) {
      const thread = await this.ensureThread(deckId);
      const result = await this.pool.query(
        'select role, content, created_at from chat_message where thread_id = $1 order by created_at asc, id asc',
        [thread.id],
      );
      return result.rows.map((row) => ({
        role: row.role === 'user' ? 'user' : 'agent',
        content: contentToText(row.content),
        createdAt: iso(row.created_at),
      }));
    }
    return (await this.readAll()).find((record) => record.deckId === deckId)?.messages ?? [];
  }

  async append(deckId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
    if (this.pool) {
      const thread = await this.ensureThread(deckId);
      for (const message of messages) {
        await this.pool.query(
          `
            insert into chat_message(id, org_id, thread_id, role, content, author_user_id, created_at)
            values ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            randomUUID(),
            thread.orgId,
            thread.id,
            message.role === 'user' ? 'user' : 'assistant',
            JSON.stringify({ text: message.content }),
            null,
            message.createdAt,
          ],
        );
      }
      return this.list(deckId);
    }

    const records = await this.readAll();
    const existing = records.find((record) => record.deckId === deckId);
    const next: ChatFileRecord = {
      deckId,
      messages: [...(existing?.messages ?? []), ...messages],
    };
    await writeJson(this.filePath, [next, ...records.filter((record) => record.deckId !== deckId)]);
    return next.messages;
  }

  private async ensureThread(deckId: string): Promise<{ id: string; orgId: string }> {
    if (!this.pool) throw new Error('Postgres pool is not configured');
    const deck = await this.pool.query('select org_id from deck where id = $1', [deckId]);
    if (!deck.rowCount) throw Object.assign(new Error('Deck not found'), { statusCode: 404 });
    const orgId = deck.rows[0].org_id;
    const result = await this.pool.query(
      `
        insert into chat_thread(id, org_id, deck_id, langgraph_thread_id)
        values ($1, $2, $3, $4)
        on conflict (deck_id) do update set deck_id = excluded.deck_id
        returning id, org_id
      `,
      [randomUUID(), orgId, deckId, deckId],
    );
    return { id: result.rows[0].id, orgId: result.rows[0].org_id };
  }

  private readAll(): Promise<ChatFileRecord[]> {
    return readJson<ChatFileRecord[]>(this.filePath, []);
  }
}

function contentToText(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { text?: unknown }).text === 'string') {
    return (value as { text: string }).text;
  }
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? '');
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
