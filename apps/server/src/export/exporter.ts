import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, ExportFormat, ExportJob } from '../core/types.js';
import { DeckStore } from '../decks/decks.js';
import { isNodeError, readRequiredJson, writeJson } from '../core/storage.js';
import { silentLogger, type ServiceLogger } from '../core/logger.js';
import { exportHtmlDeck } from './htmlDeckExporter.js';
import { exportNativePptx } from './htmlDeckNativeExporter.js';

interface QueuedExport {
  job: ExportJob;
  markdown: string;
  mode: string;
  htmlRuntime: boolean;
  deckDir: string;
}

/**
 * Tracks export jobs and runs dependency-light local exports.
 */
export class ExportService {
  private readonly queue: QueuedExport[] = [];
  private running = 0;
  private readonly startupReconcile: Promise<void>;

  constructor(
    private readonly config: AppConfig,
    private readonly decks: DeckStore,
    private readonly logger: ServiceLogger = silentLogger,
  ) {
    this.startupReconcile = this.reconcileStaleJobs()
      .then((jobs) => {
        if (jobs.length) this.logger.warn({ count: jobs.length }, 'reconciled interrupted export jobs');
      })
      .then(() => undefined);
  }

  /**
   * Resolves after startup has marked interrupted queued/running jobs failed.
   */
  whenReady(): Promise<void> {
    return this.startupReconcile;
  }

  /**
   * Export work is process-local in v1. If the server restarts, queued/running
   * jobs cannot be resumed safely, so make that explicit and let users retry.
   */
  async reconcileStaleJobs(reason = 'Export job was interrupted by a server restart. Retry the export.'): Promise<ExportJob[]> {
    const jobsDir = path.join(this.config.dataDir, 'jobs');
    let entries: string[];
    try {
      entries = await fs.readdir(jobsDir);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw error;
    }

    const reconciled: ExportJob[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const jobPath = path.join(jobsDir, entry);
      const job = await readRequiredJson<ExportJob>(jobPath, 'Export job');
      if (job.status !== 'queued' && job.status !== 'running') continue;

      const failedAt = new Date().toISOString();
      const failedJob: ExportJob = {
        ...job,
        status: 'failed',
        error: reason,
        updatedAt: failedAt,
      };
      await writeJson(jobPath, failedJob);
      await this.decks.updateMeta(job.deckId, {
        pptx: {
          id: job.id,
          format: job.format,
          status: 'failed',
          error: reason,
          updatedAt: failedAt,
        },
      }).catch(() => undefined);
      reconciled.push(failedJob);
    }
    return reconciled;
  }

  /** Starts a queued export for an HTML runtime deck. */
  async start(deckId: string, input: { format?: ExportFormat; mode?: string }): Promise<ExportJob> {
    await this.whenReady();
    const deck = await this.decks.get(deckId);
    const format = input.format ?? 'pptx';
    if (format !== 'pptx' && format !== 'pdf' && format !== 'markdown' && format !== 'pptx-native') {
      throw Object.assign(new Error('Unsupported export format'), { statusCode: 400 });
    }
    const deckDir = this.decks.deckPath(deckId);
    const htmlRuntime = await fs.access(path.join(deckDir, 'deck.json')).then(() => true).catch(() => false);
    if (htmlRuntime && format === 'markdown') {
      throw Object.assign(new Error('Markdown export is not available for HTML decks'), { statusCode: 400 });
    }
    if (!htmlRuntime) throw Object.assign(new Error('Deck workspace is missing deck.json'), { statusCode: 400 });

    const now = new Date().toISOString();
    const job: ExportJob = {
      id: randomUUID(),
      deckId,
      format,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      mode: normalizeMode(input.mode),
    };
    await this.writeJob(job);
    this.logger.info({ jobId: job.id, deckId, format, mode: job.mode }, 'export queued');

    this.enqueue({ job, markdown: deck.markdown, mode: job.mode ?? 'screenshot', htmlRuntime, deckDir });

    return job;
  }

  /**
   * Reads a single export job.
   */
  async get(jobId: string): Promise<ExportJob> {
    await this.whenReady();
    this.assertJobId(jobId);
    return readRequiredJson<ExportJob>(this.jobFile(jobId), 'Export job');
  }

  private enqueue(item: QueuedExport): void {
    this.queue.push(item);
    this.processQueue();
  }

  private processQueue(): void {
    while (this.running < this.config.export.concurrency && this.queue.length) {
      const item = this.queue.shift();
      if (!item) return;
      this.running += 1;
      void this.run(item)
        .catch((error: unknown) => this.failJob(item.job, error))
        .finally(() => {
          this.running -= 1;
          this.processQueue();
        });
    }
  }

  private async failJob(job: ExportJob, error: unknown): Promise<void> {
    const failedAt = new Date().toISOString();
    const failed = {
      id: job.id,
      format: job.format,
      status: 'failed' as const,
      error: error instanceof Error ? error.message : String(error),
      updatedAt: failedAt,
    };
    await this.writeJob({
      ...job,
      status: failed.status,
      updatedAt: failedAt,
      error: failed.error,
    });
    await this.decks.updateMeta(job.deckId, { pptx: failed });
    this.logger.error({ jobId: job.id, deckId: job.deckId, error: failed.error }, 'export failed');
  }

  private async run(item: QueuedExport): Promise<void> {
    const { job, markdown, mode, htmlRuntime, deckDir } = item;
    this.logger.info({ jobId: job.id, deckId: job.deckId, format: job.format, mode }, 'export started');
    await this.writeJob({ ...job, status: 'running', updatedAt: new Date().toISOString() });

    if (job.format === 'markdown') {
      const outputPath = path.join(this.config.dataDir, 'exports', `${job.id}.md`);
      await fs.writeFile(outputPath, markdown, 'utf8');
      await this.writeJob({
        ...job,
        status: 'succeeded',
        updatedAt: new Date().toISOString(),
        outputPath,
        downloadUrl: `/api/exports/${job.id}/download`,
      });
      await this.decks.updateMeta(job.deckId, {
        pptx: {
          id: job.id,
          format: job.format,
          status: 'succeeded',
          downloadUrl: `/api/exports/${job.id}/download`,
          updatedAt: new Date().toISOString(),
        },
      });
      this.logger.info({ jobId: job.id, deckId: job.deckId, format: job.format, outputPath }, 'export succeeded');
      return;
    }

    if (htmlRuntime) {
      if (job.format === 'pptx-native') {
        const outputPath = path.join(this.config.dataDir, 'exports', `${job.id}.pptx`);
        const controller = new AbortController();
        const result = await withTimeout(exportNativePptx({
          deckDir,
          shellDir: path.join(this.config.repoRoot, 'runtime'),
          outputPath,
          signal: controller.signal,
        }), this.config.export.timeoutMs, () => controller.abort());
        const completedAt = new Date().toISOString();
        await this.writeJob({
          ...job,
          status: 'succeeded',
          updatedAt: completedAt,
          outputPath,
          downloadUrl: `/api/exports/${job.id}/download`,
          verification: result.verification,
        });
        await this.decks.updateMeta(job.deckId, {
          pptx: {
            id: job.id,
            format: 'pptx-native',
            status: 'succeeded',
            downloadUrl: `/api/exports/${job.id}/download`,
            updatedAt: completedAt,
            verification: result.verification,
          },
        });
        this.logger.info({ jobId: job.id, deckId: job.deckId, format: job.format, outputPath, verification: result.verification }, 'export succeeded');
        return;
      }

      const extension = job.format === 'pdf' ? 'pdf' : 'pptx';
      const outputPath = path.join(this.config.dataDir, 'exports', `${job.id}.${extension}`);
      const controller = new AbortController();
      const result = await withTimeout(exportHtmlDeck({
        deckDir,
        shellDir: path.join(this.config.repoRoot, 'runtime'),
        format: job.format as 'pptx' | 'pdf',
        outputPath,
        signal: controller.signal,
      }), this.config.export.timeoutMs, () => controller.abort());
      const completedAt = new Date().toISOString();
      await this.writeJob({
        ...job,
        status: 'succeeded',
        updatedAt: completedAt,
        outputPath,
        downloadUrl: `/api/exports/${job.id}/download`,
        verification: result.verification,
      });
      await this.decks.updateMeta(job.deckId, {
        pptx: {
          id: job.id,
          format: job.format,
          status: 'succeeded',
          downloadUrl: `/api/exports/${job.id}/download`,
          updatedAt: completedAt,
          verification: result.verification,
        },
      });
      this.logger.info({ jobId: job.id, deckId: job.deckId, format: job.format, outputPath, verification: result.verification }, 'export succeeded');
      return;
    }

    throw new Error('PPTX export requires an HTML runtime deck.');
  }

  private writeJob(job: ExportJob): Promise<void> {
    return writeJson(this.jobFile(job.id), job);
  }

  private jobFile(jobId: string): string {
    this.assertJobId(jobId);
    return path.join(this.config.dataDir, 'jobs', `${jobId}.json`);
  }

  private assertJobId(jobId: string): void {
    if (!/^[a-f0-9-]{36}$/i.test(jobId)) {
      throw Object.assign(new Error('Invalid export job id'), { statusCode: 400 });
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`Export process timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function normalizeMode(value: string | undefined): string {
  if (!value || value === 'screenshot') return 'screenshot';
  throw Object.assign(new Error('Unsupported export mode'), { statusCode: 400 });
}
