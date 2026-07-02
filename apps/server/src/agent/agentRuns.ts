import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentRunRecord, AgentRunStatus, AppConfig } from '../core/types.js';
import type { PgPool } from '../db/db.js';
import { readJson, writeJson } from '../core/storage.js';

/**
 * Persists agent run lifecycle state and owns in-process cancellation handles.
 */
export class AgentRunService {
  private readonly runsPath: string;
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly config: AppConfig,
    private readonly pool: PgPool | null = null,
  ) {
    this.runsPath = path.join(config.dataDir, 'agent-runs.json');
  }

  async start(input: { deckId: string; model: string; roleScope: 'admin' | 'member'; controller: AbortController }): Promise<AgentRunRecord> {
    const record: AgentRunRecord = {
      id: randomUUID(),
      deckId: input.deckId,
      threadId: input.deckId,
      status: 'running',
      model: input.model,
      roleScope: input.roleScope,
      startedAt: new Date().toISOString(),
    };
    this.controllers.set(record.id, input.controller);

    if (this.pool) await this.insertDbRun(record);
    else await this.writeJsonRun(record);
    return record;
  }

  async finish(id: string, status: Exclude<AgentRunStatus, 'running'>, error?: string): Promise<AgentRunRecord | null> {
    this.controllers.delete(id);
    const endedAt = new Date().toISOString();
    if (this.pool) {
      const result = await this.pool.query(
        `
          update agent_run
          set status = $2,
              ended_at = $3,
              error = $4
          where id = $1
          returning *
        `,
        [id, status, endedAt, error ?? null],
      );
      return result.rowCount ? rowToRun(result.rows[0]) : null;
    }

    const runs = await this.readJsonRuns();
    let updated: AgentRunRecord | null = null;
    await writeJson(this.runsPath, runs.map((run) => {
      if (run.id !== id) return run;
      updated = { ...run, status, endedAt, error };
      return updated;
    }));
    return updated;
  }

  async cancel(id: string): Promise<AgentRunRecord | null> {
    const existing = await this.get(id);
    if (!existing || existing.status !== 'running') return existing;
    this.controllers.get(id)?.abort(new Error('Agent run canceled'));
    return this.finish(id, 'canceled', 'Canceled by user');
  }

  async list(deckId: string): Promise<AgentRunRecord[]> {
    if (this.pool) {
      const result = await this.pool.query('select * from agent_run where deck_id = $1 order by started_at desc limit 25', [deckId]);
      return result.rows.map(rowToRun);
    }
    const runs = await this.readJsonRuns();
    return runs.filter((run) => run.deckId === deckId).sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, 25);
  }

  private async get(id: string): Promise<AgentRunRecord | null> {
    if (this.pool) {
      const result = await this.pool.query('select * from agent_run where id = $1 limit 1', [id]);
      return result.rowCount ? rowToRun(result.rows[0]) : null;
    }
    return (await this.readJsonRuns()).find((run) => run.id === id) ?? null;
  }

  private async insertDbRun(record: AgentRunRecord): Promise<void> {
    if (!this.pool) return;
    const deck = await this.pool.query('select org_id from deck where id = $1', [record.deckId]);
    if (!deck.rowCount) throw Object.assign(new Error('Deck not found'), { statusCode: 404 });
    const thread = await this.pool.query(
      `
        insert into chat_thread(id, org_id, deck_id, langgraph_thread_id)
        values ($1, $2, $3, $4)
        on conflict (deck_id) do update set langgraph_thread_id = excluded.langgraph_thread_id
        returning id
      `,
      [randomUUID(), deck.rows[0].org_id, record.deckId, record.threadId],
    );
    await this.pool.query(
      `
        insert into agent_run (
          id, org_id, deck_id, thread_id, status, model, role_scope, started_at, ended_at, error
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
      `,
      [
        record.id,
        deck.rows[0].org_id,
        record.deckId,
        thread.rows[0].id,
        record.status,
        record.model,
        record.roleScope,
        record.startedAt,
        record.endedAt ?? null,
        record.error ?? null,
      ],
    );
  }

  private async writeJsonRun(record: AgentRunRecord): Promise<void> {
    const runs = await this.readJsonRuns();
    await writeJson(this.runsPath, [record, ...runs]);
  }

  private readJsonRuns(): Promise<AgentRunRecord[]> {
    return readJson<AgentRunRecord[]>(this.runsPath, []);
  }
}

function rowToRun(row: Record<string, unknown>): AgentRunRecord {
  return {
    id: String(row.id),
    deckId: String(row.deck_id),
    threadId: String(row.thread_id),
    status: normalizeStatus(row.status),
    model: String(row.model),
    roleScope: row.role_scope === 'admin' ? 'admin' : 'member',
    startedAt: iso(row.started_at),
    endedAt: row.ended_at ? iso(row.ended_at) : undefined,
    error: typeof row.error === 'string' ? row.error : undefined,
  };
}

function normalizeStatus(value: unknown): AgentRunStatus {
  if (value === 'done' || value === 'canceled' || value === 'error') return value;
  return 'running';
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
