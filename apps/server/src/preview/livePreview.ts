import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '../core/types.js';
import { silentLogger, type ServiceLogger } from '../core/logger.js';

export interface LivePreviewHandle {
  deckId: string;
  port: number;
  url: string;
  status: 'starting' | 'running' | 'stopped' | 'crashed';
  startedAt: string;
  lastActivityAt: number;
  pid?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  hmr?: LivePreviewHmrConfig;
  restartAttempts: number;
  error?: string;
}

export interface LivePreviewHmrConfig {
  host: string;
  protocol: 'ws' | 'wss';
  clientPort: number;
  path: string;
}

interface LivePreviewProcess {
  deckId: string;
  deckDir: string;
  slidesFile: string;
  port: number;
  url: string;
  hmr?: LivePreviewHmrConfig;
  status: 'starting' | 'running' | 'stopped' | 'crashed';
  startedAt: string;
  lastActivityAt: number;
  proc: ChildProcess;
  ready?: Promise<LivePreviewHandle>;
  stderr: string;
  restartAttempts: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  restartTimer?: NodeJS.Timeout;
}

/**
 * Starts and reuses local Slidev dev servers for authenticated workbench previews.
 */
export class LivePreviewSupervisor {
  private readonly processes = new Map<string, LivePreviewProcess>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: ServiceLogger = silentLogger,
  ) {
    this.sweepTimer = setInterval(() => {
      this.sweepIdle();
    }, Math.min(config.livePreview.deckIdleTimeoutMs, 60_000));
    this.sweepTimer.unref();
  }

  async start(deckId: string, deckDir: string, slidesFile: string): Promise<LivePreviewHandle> {
    const existing = this.processes.get(deckId);
    if (existing && existing.status !== 'crashed' && !existing.proc.killed) {
      existing.lastActivityAt = Date.now();
      await writeLiveHashRouterEntry(deckDir, slidesFile);
      this.logger.debug({ deckId, port: existing.port, status: existing.status, pid: existing.proc.pid }, 'live preview reused');
      return existing.ready ?? this.toHandle(existing);
    }
    if (existing?.status === 'crashed') {
      this.logger.warn({ deckId, port: existing.port, exitCode: existing.exitCode, signal: existing.signal }, 'discarding crashed live preview');
      this.processes.delete(deckId);
    }

    await this.enforceCapacity();
    return this.spawnPreview(deckId, deckDir, slidesFile, 0);
  }

  async refresh(deckId: string, deckDir: string, slidesFile: string): Promise<LivePreviewHandle | undefined> {
    await writeLiveHashRouterEntry(deckDir, slidesFile);
    const existing = this.processes.get(deckId);
    if (!existing || existing.status === 'crashed' || existing.proc.killed) return undefined;
    existing.lastActivityAt = Date.now();
    this.logger.debug({ deckId, port: existing.port, status: existing.status, pid: existing.proc.pid }, 'live preview refreshed');
    return existing.ready ?? this.toHandle(existing);
  }

  private async spawnPreview(deckId: string, deckDir: string, slidesFile: string, restartAttempts: number): Promise<LivePreviewHandle> {
    const port = await this.allocatePort();
    const startedAt = new Date().toISOString();
    const base = this.previewBase(deckId);
    const hmr = this.hmrConfig(deckId);
    const liveSlidesFile = await writeLiveHashRouterEntry(deckDir, slidesFile);
    const { command, args } = this.runnerCommand([
      '--entry',
      liveSlidesFile,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--base',
      base,
      ...(hmr ? [
        '--hmr-host',
        hmr.host,
        '--hmr-protocol',
        hmr.protocol,
        '--hmr-client-port',
        String(hmr.clientPort),
        '--hmr-path',
        hmr.path,
      ] : []),
    ]);
    const proc = spawn(command, args, {
      cwd: deckDir,
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.logger.info({
      deckId,
      port,
      pid: proc.pid,
      command,
      restartAttempts,
      hmr,
    }, 'live preview spawned');

    const entry: LivePreviewProcess = {
      deckId,
      deckDir,
      slidesFile,
      port,
      url: this.previewUrl(deckId, port),
      hmr,
      status: 'starting',
      startedAt,
      lastActivityAt: Date.now(),
      proc,
      stderr: '',
      restartAttempts,
    };
    entry.ready = this.waitUntilReady(entry);
    this.processes.set(deckId, entry);

    proc.stdout?.resume();
    proc.stderr?.on('data', (chunk) => {
      entry.stderr = `${entry.stderr}${chunk.toString()}`.slice(-4_000);
    });
    proc.once('exit', (code, signal) => {
      entry.status = code === 0 || signal === 'SIGTERM' ? 'stopped' : 'crashed';
      entry.exitCode = code;
      entry.signal = signal;
      entry.ready = undefined;
      if (this.processes.get(deckId) !== entry) return;
      if (entry.status === 'stopped') {
        this.logger.info({ deckId, port: entry.port, pid: entry.proc.pid, code, signal }, 'live preview stopped');
        this.processes.delete(deckId);
        return;
      }
      this.logger.error({
        deckId,
        port: entry.port,
        pid: entry.proc.pid,
        code,
        signal,
        stderr: entry.stderr.trim() || undefined,
      }, 'live preview crashed');
      this.scheduleRestart(entry);
    });

    return entry.ready;
  }

  list(): LivePreviewHandle[] {
    return [...this.processes.values()].map((entry) => this.toHandle(entry));
  }

  get(deckId: string): LivePreviewHandle | undefined {
    const entry = this.processes.get(deckId);
    if (!entry) return undefined;
    entry.lastActivityAt = Date.now();
    return this.toHandle(entry);
  }

  async stopAll(): Promise<void> {
    clearInterval(this.sweepTimer);
    await Promise.all([...this.processes.keys()].map((deckId) => this.stop(deckId)));
  }

  async stop(deckId: string): Promise<void> {
    const entry = this.processes.get(deckId);
    if (!entry) return;
    entry.status = 'stopped';
    if (entry.restartTimer) clearTimeout(entry.restartTimer);
    this.processes.delete(deckId);
    this.logger.info({ deckId, port: entry.port, pid: entry.proc.pid }, 'stopping live preview');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!entry.proc.killed) entry.proc.kill('SIGKILL');
        resolve();
      }, 2_000);
      entry.proc.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      if (!entry.proc.killed) entry.proc.kill('SIGTERM');
    });
  }

  private sweepIdle(): void {
    const now = Date.now();
    for (const [deckId, entry] of this.processes.entries()) {
      if (entry.status === 'running' && now - entry.lastActivityAt > this.config.livePreview.deckIdleTimeoutMs) {
        this.logger.info({ deckId, port: entry.port, idleMs: now - entry.lastActivityAt }, 'live preview idle timeout');
        void this.stop(deckId);
      }
    }
  }

  private async enforceCapacity(): Promise<void> {
    if (this.processes.size < this.config.livePreview.maxConcurrentDecks) return;
    const oldest = [...this.processes.values()].sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];
    if (!oldest) return;
    this.logger.warn({
      deckId: oldest.deckId,
      port: oldest.port,
      activePreviews: this.processes.size,
      maxConcurrentDecks: this.config.livePreview.maxConcurrentDecks,
    }, 'live preview capacity eviction');
    await this.stop(oldest.deckId);
  }

  private async allocatePort(): Promise<number> {
    const used = new Set([...this.processes.values()]
      .filter((entry) => entry.status !== 'crashed')
      .map((entry) => entry.port));
    for (let port = this.config.livePreview.portPoolStart; port <= this.config.livePreview.portPoolEnd; port += 1) {
      if (!used.has(port) && await isPortAvailable(port)) return port;
    }
    throw Object.assign(new Error('No live preview ports available'), { statusCode: 503 });
  }

  private async waitUntilReady(entry: LivePreviewProcess): Promise<LivePreviewHandle> {
    const deadline = Date.now() + 45_000;
    const started = Date.now();
    let lastError = '';
    while (Date.now() < deadline) {
      if (entry.proc.exitCode !== null) {
        if (entry.status === 'crashed' && entry.restartAttempts < this.config.livePreview.crashRetryLimit) {
          return this.waitForRestart(entry, deadline);
        }
        break;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${entry.port}${this.previewBase(entry.deckId)}`);
        if (response.status < 500) {
          entry.status = 'running';
          this.logger.info({ deckId: entry.deckId, port: entry.port, pid: entry.proc.pid, readyMs: Date.now() - started }, 'live preview ready');
          return this.toHandle(entry);
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await delay(500);
    }
    if (entry.proc.exitCode === null) {
      await this.stop(entry.deckId);
    }
    const details = entry.stderr.trim() || lastError;
    this.logger.error({ deckId: entry.deckId, port: entry.port, pid: entry.proc.pid, details }, 'live preview startup timeout');
    throw Object.assign(new Error(`Slidev live preview did not start${details ? `: ${details}` : ''}`), { statusCode: 504 });
  }

  private async waitForRestart(entry: LivePreviewProcess, deadline: number): Promise<LivePreviewHandle> {
    while (Date.now() < deadline) {
      const current = this.processes.get(entry.deckId);
      if (current && current !== entry) return current.ready ?? this.toHandle(current);
      await delay(100);
    }
    const details = entry.stderr.trim() || 'Live preview crashed before becoming ready';
    throw Object.assign(new Error(`Slidev live preview did not restart${details ? `: ${details}` : ''}`), { statusCode: 504 });
  }

  private toHandle(entry: LivePreviewProcess): LivePreviewHandle {
    return {
      deckId: entry.deckId,
      port: entry.port,
      url: entry.url,
      status: entry.status,
      startedAt: entry.startedAt,
      lastActivityAt: entry.lastActivityAt,
      pid: entry.proc.pid,
      exitCode: entry.exitCode ?? entry.proc.exitCode,
      signal: entry.signal ?? entry.proc.signalCode,
      hmr: entry.hmr,
      restartAttempts: entry.restartAttempts,
      error: entry.status === 'crashed' ? entry.stderr.trim() || 'Live preview crashed' : undefined,
    };
  }

  private scheduleRestart(entry: LivePreviewProcess): void {
    if (entry.restartAttempts >= this.config.livePreview.crashRetryLimit) return;
    const delayMs = this.config.livePreview.crashRetryDelayMs * (entry.restartAttempts + 1);
    this.logger.warn({
      deckId: entry.deckId,
      port: entry.port,
      restartAttempts: entry.restartAttempts + 1,
      delayMs,
    }, 'live preview restart scheduled');
    entry.restartTimer = setTimeout(() => {
      if (this.processes.get(entry.deckId) !== entry) return;
      void this.spawnPreview(entry.deckId, entry.deckDir, entry.slidesFile, entry.restartAttempts + 1)
        .catch(() => {
          const current = this.processes.get(entry.deckId);
          if (current) current.status = 'crashed';
        });
    }, delayMs);
    entry.restartTimer.unref();
  }

  private runnerCommand(args: string[]): { command: string; args: string[] } {
    const override = process.env.SLIDEV_AGENT_PREVIEW_RUNNER;
    if (override) return { command: override, args };
    return {
      command: process.execPath,
      args: [fileURLToPath(new URL('./slidevPreviewRunner.js', import.meta.url)), ...args],
    };
  }

  private previewBase(deckId: string): string {
    return '/';
  }

  private previewUrl(deckId: string, port: number): string {
    if (!this.config.decksDomain) return `http://127.0.0.1:${port}/#/1`;
    const protocol = this.config.publicBaseUrl.startsWith('https://') ? 'https' : 'http';
    return `${protocol}://${deckId}.${this.config.decksDomain}/#/1`;
  }

  private hmrConfig(deckId: string): LivePreviewHmrConfig | undefined {
    const publicUrl = new URL(this.config.publicBaseUrl);
    const https = publicUrl.protocol === 'https:';
    const clientPort = Number(publicUrl.port) || (https ? 443 : 80);
    if (!this.config.decksDomain) {
      return undefined;
    }
    return {
      host: `${deckId}.${this.config.decksDomain}`,
      protocol: https ? 'wss' : 'ws',
      clientPort,
      path: '/__hmr',
    };
  }
}

async function writeLiveHashRouterEntry(deckDir: string, slidesFile: string): Promise<string> {
  const markdown = await fs.readFile(slidesFile, 'utf8');
  const liveSlidesFile = path.join(deckDir, '.slidev-agent-live.md');
  await fs.writeFile(liveSlidesFile, ensureHashRouterMarkdown(markdown), 'utf8');
  return liveSlidesFile;
}

function ensureHashRouterMarkdown(markdown: string): string {
  if (!markdown.startsWith('---\n')) {
    return `---\nrouterMode: hash\n---\n\n${markdown}`;
  }

  const endIndex = markdown.indexOf('\n---', 4);
  if (endIndex === -1) {
    return `---\nrouterMode: hash\n---\n\n${markdown}`;
  }

  const frontmatter = markdown.slice(4, endIndex);
  const body = markdown.slice(endIndex);
  const updatedFrontmatter = /^routerMode:/m.test(frontmatter)
    ? frontmatter.replace(/^routerMode:.*$/m, 'routerMode: hash')
    : `routerMode: hash\n${frontmatter}`;
  return `---\n${updatedFrontmatter}${body}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, '127.0.0.1');
  });
}
