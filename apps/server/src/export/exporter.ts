import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, ExportFormat, ExportJob } from '../core/types.js';
import { DeckStore } from '../decks/decks.js';
import { isNodeError, readRequiredJson, writeJson } from '../core/storage.js';
import { silentLogger, type ServiceLogger } from '../core/logger.js';

interface QueuedExport {
  job: ExportJob;
  markdown: string;
  mode: string;
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
          status: 'failed',
          error: reason,
          updatedAt: failedAt,
        },
      }).catch(() => undefined);
      reconciled.push(failedJob);
    }
    return reconciled;
  }

  /**
   * Starts an export job. Markdown exports complete in-process; PPTX exports
   * invoke the repository's built `slidev-to-pptx` CLI.
   */
  async start(deckId: string, input: { format?: ExportFormat; mode?: string }): Promise<ExportJob> {
    await this.whenReady();
    const deck = await this.decks.get(deckId);
    const format = input.format ?? 'pptx';
    if (format !== 'pptx' && format !== 'markdown') {
      throw Object.assign(new Error('Unsupported export format'), { statusCode: 400 });
    }

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

    this.enqueue({ job, markdown: deck.markdown, mode: job.mode ?? 'screenshot' });

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
      void this.run(item.job, item.markdown, item.mode)
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

  private async run(job: ExportJob, markdown: string, mode: string): Promise<void> {
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
          status: 'succeeded',
          downloadUrl: `/api/exports/${job.id}/download`,
          updatedAt: new Date().toISOString(),
        },
      });
      this.logger.info({ jobId: job.id, deckId: job.deckId, format: job.format, outputPath }, 'export succeeded');
      return;
    }

    const cliPath = path.join(this.config.repoRoot, 'dist', 'slidev-to-pptx', 'cli.js');
    const verifyPath = path.join(this.config.repoRoot, 'dist', 'slidev-to-pptx', 'verify.js');
    await fs.access(cliPath).catch(() => {
      throw new Error('PPTX exporter is not built. Run `npm run build` at the repository root before requesting PPTX export.');
    });

    const outputPath = path.join(this.config.dataDir, 'exports', `${job.id}.pptx`);
    const deckPath = this.decks.deckFile(job.deckId);
    await runNode(this.config.repoRoot, [
      cliPath,
      deckPath,
      outputPath,
      '--mode',
      mode,
    ], this.config.export.timeoutMs);

    const verification = mode === 'screenshot'
      ? await this.verifyPptx(verifyPath, outputPath, expectedSlideCount(markdown))
      : undefined;

    const completedAt = new Date().toISOString();
    await this.writeJob({
      ...job,
      status: 'succeeded',
      updatedAt: completedAt,
      outputPath,
      downloadUrl: `/api/exports/${job.id}/download`,
      verification,
    });
    await this.decks.updateMeta(job.deckId, {
      pptx: {
        id: job.id,
        status: 'succeeded',
        downloadUrl: `/api/exports/${job.id}/download`,
        updatedAt: completedAt,
        verification,
      },
    });
    this.logger.info({
      jobId: job.id,
      deckId: job.deckId,
      format: job.format,
      mode,
      outputPath,
      verification,
    }, 'export succeeded');
  }

  private async verifyPptx(verifyPath: string, outputPath: string, slideCount: number): Promise<NonNullable<ExportJob['verification']>> {
    await fs.access(verifyPath).catch(() => {
      throw new Error('PPTX verifier is not built. Run `npm run build` at the repository root before requesting PPTX export.');
    });
    const output = await runNode(this.config.repoRoot, [
      verifyPath,
      outputPath,
      '--slides',
      String(slideCount),
      '--scale',
      '2',
    ], this.config.export.timeoutMs);
    return {
      ok: true,
      slideCount: numericLine(output, 'Slides') ?? slideCount,
      imageCount: numericLine(output, 'Images') ?? slideCount,
    };
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

function runNode(cwd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Export process timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `Exporter exited with code ${code}`));
    });
  });
}

function normalizeMode(value: string | undefined): string {
  if (!value) return 'screenshot';
  if (value === 'screenshot' || value === 'editable' || value === 'hybrid') return value;
  throw Object.assign(new Error('Unsupported export mode'), { statusCode: 400 });
}

function expectedSlideCount(markdown: string): number {
  const content = stripHeadmatter(markdown).trim();
  if (!content) return 1;
  return content.split(/^---\s*$/m).filter((part) => part.trim()).length || 1;
}

function stripHeadmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  if (end < 0) return markdown;
  return markdown.slice(end + 4);
}

function numericLine(output: string, label: string): number | undefined {
  const match = output.match(new RegExp(`^${label}:\\s+(\\d+)`, 'm'));
  return match ? Number(match[1]) : undefined;
}
