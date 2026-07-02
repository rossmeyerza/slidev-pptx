import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../core/types.js';
import { DeckStore } from '../decks/decks.js';
import { isNodeError } from '../core/storage.js';

export interface SlidevBuildStatus {
  deckId: string;
  kind: 'draft' | 'published';
  status: 'missing' | 'building' | 'fresh' | 'stale' | 'failed';
  outDir: string;
  builtAt?: string;
  sourceHash?: string;
  manifestHash?: string;
  error?: string;
}

interface SlidevBuildManifest {
  deckId: string;
  kind: 'draft' | 'published';
  sourceHash: string;
  builtAt: string;
}

/**
 * Builds and serves static Slidev output for draft/published views.
 */
export class SlidevBuildService {
  private readonly builds = new Map<string, Promise<string>>();
  private readonly lastErrors = new Map<string, string>();

  constructor(
    private readonly config: AppConfig,
    private readonly decks: DeckStore,
  ) {}

  async build(id: string, kind: 'draft' | 'published'): Promise<string> {
    return this.withBuildLock(id, kind, () => this.buildUnlocked(id, kind));
  }

  async ensureBuilt(id: string, kind: 'draft' | 'published'): Promise<string> {
    const key = this.buildKey(id, kind);
    const pending = this.builds.get(key);
    const outDir = this.outDir(id, kind);
    const hasIndex = await this.hasUsableIndex(outDir);
    if (pending) {
      if (hasIndex) return outDir;
      return pending;
    }

    const status = await this.status(id, kind);
    if (status.status === 'fresh') return outDir;
    if (hasIndex && status.status === 'stale') {
      this.buildInBackground(id, kind);
      return outDir;
    }
    return this.build(id, kind);
  }

  async status(id: string, kind: 'draft' | 'published'): Promise<SlidevBuildStatus> {
    const key = this.buildKey(id, kind);
    const outDir = this.outDir(id, kind);
    if (this.builds.has(key)) {
      return {
        deckId: id,
        kind,
        status: 'building',
        outDir,
      };
    }

    const hasIndex = await this.hasUsableIndex(outDir);
    const sourceHash = await this.sourceHash(id).catch(() => undefined);
    const manifest = await this.readManifest(id, kind);
    if (!hasIndex || !manifest) {
      return {
        deckId: id,
        kind,
        status: this.lastErrors.has(key) ? 'failed' : 'missing',
        outDir,
        sourceHash,
        error: this.lastErrors.get(key),
      };
    }

    const fresh = Boolean(sourceHash && manifest.sourceHash === sourceHash);
    return {
      deckId: id,
      kind,
      status: fresh ? 'fresh' : 'stale',
      outDir,
      builtAt: manifest.builtAt,
      sourceHash,
      manifestHash: manifest.sourceHash,
      error: this.lastErrors.get(key),
    };
  }

  buildInBackground(id: string, kind: 'draft' | 'published'): void {
    const key = this.buildKey(id, kind);
    if (this.builds.has(key)) return;
    void this.build(id, kind).catch((error: unknown) => {
      this.lastErrors.set(key, error instanceof Error ? error.message : String(error));
    });
  }

  async hasCachedBuild(id: string, kind: 'draft' | 'published'): Promise<boolean> {
    return this.hasUsableIndex(this.outDir(id, kind));
  }

  outDir(id: string, kind: 'draft' | 'published'): string {
    return path.join(this.config.dataDir, kind, id);
  }

  private async hasUsableIndex(outDir: string): Promise<boolean> {
    try {
      const indexHtml = await fs.readFile(path.join(outDir, 'index.html'), 'utf8');
      return indexHtml.includes('<div id="app">') && indexHtml.includes('src="./assets/');
    } catch {
      return false;
    }
  }

  private async withBuildLock(id: string, kind: 'draft' | 'published', build: () => Promise<string>): Promise<string> {
    const key = this.buildKey(id, kind);
    const existing = this.builds.get(key);
    if (existing) return existing;

    const pending = build()
      .then((outDir) => {
        this.lastErrors.delete(key);
        return outDir;
      })
      .catch((error: unknown) => {
        this.lastErrors.set(key, error instanceof Error ? error.message : String(error));
        throw error;
      })
      .finally(() => {
        this.builds.delete(key);
      });
    this.builds.set(key, pending);
    return pending;
  }

  private async buildUnlocked(id: string, kind: 'draft' | 'published'): Promise<string> {
    const deckDir = this.decks.deckPath(id);
    const outDir = this.outDir(id, kind);
    await ensureHashRouter(this.decks.deckFile(id));
    await ensureNodeModulePackages(deckDir, this.config.repoRoot);
    const sourceHash = await this.sourceHash(id);
    const tempDir = path.join(this.config.dataDir, `${kind}-tmp`, `${id}-${process.pid}-${Date.now()}`);
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });
    try {
      await runSlidev(deckDir, [
        'build',
        this.decks.deckFile(id),
        '--out',
        tempDir,
        '--base',
        './',
      ]);
      await this.writeManifest(tempDir, {
        deckId: id,
        kind,
        sourceHash,
        builtAt: new Date().toISOString(),
      });
      await fs.rm(outDir, { recursive: true, force: true });
      await fs.mkdir(path.dirname(outDir), { recursive: true });
      await fs.rename(tempDir, outDir);
      return outDir;
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private buildKey(id: string, kind: 'draft' | 'published'): string {
    return `${kind}:${id}`;
  }

  private manifestFile(outDir: string): string {
    return path.join(outDir, '.slidev-agent-build.json');
  }

  private async readManifest(id: string, kind: 'draft' | 'published'): Promise<SlidevBuildManifest | null> {
    try {
      return JSON.parse(await fs.readFile(this.manifestFile(this.outDir(id, kind)), 'utf8')) as SlidevBuildManifest;
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      return null;
    }
  }

  private async writeManifest(outDir: string, manifest: SlidevBuildManifest): Promise<void> {
    await fs.writeFile(this.manifestFile(outDir), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  private async sourceHash(id: string): Promise<string> {
    const deckDir = this.decks.deckPath(id);
    const files = await relevantSourceFiles(deckDir);
    const hash = createHash('sha256');
    for (const file of files) {
      const relative = path.relative(deckDir, file);
      hash.update(relative);
      hash.update('\0');
      hash.update(await fs.readFile(file));
      hash.update('\0');
    }
    return hash.digest('base64url');
  }
}

async function relevantSourceFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  await collect(root);
  return result.sort();

  async function collect(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collect(fullPath);
        continue;
      }
      if (entry.isFile() && isRelevantSourceFile(fullPath)) result.push(fullPath);
    }
  }
}

function isRelevantSourceFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  if (basename === 'meta.json' || basename === '.slidev-agent-build.json' || basename === '.slidev-agent-live.md' || basename === 'index.html') return false;
  const extension = path.extname(filePath).toLowerCase();
  return ['.md', '.vue', '.js', '.ts', '.json', '.css', '.scss', '.html', '.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(extension);
}

async function ensureNodeModulePackages(deckDir: string, repoRoot: string): Promise<void> {
  const deckNodeModules = path.join(deckDir, 'node_modules');
  const rootNodeModules = path.join(repoRoot, 'node_modules');
  await fs.mkdir(deckNodeModules, { recursive: true });
  const packageJson = await readDeckPackageJson(deckDir);
  const packageNames = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);

  for (const packageName of packageNames) {
    await ensurePackageLink(deckNodeModules, rootNodeModules, packageName);
  }
}

async function readDeckPackageJson(deckDir: string): Promise<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> {
  try {
    return JSON.parse(await fs.readFile(path.join(deckDir, 'package.json'), 'utf8'));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function ensurePackageLink(deckNodeModules: string, rootNodeModules: string, packageName: string): Promise<void> {
  const source = path.join(rootNodeModules, packageName);
  const destination = path.join(deckNodeModules, packageName);
  try {
    await fs.stat(source);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }

  try {
    await fs.lstat(destination);
    return;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }

  if (packageName.startsWith('@')) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
  }
  await fs.symlink(source, destination, 'dir');
}

async function ensureHashRouter(deckFile: string): Promise<void> {
  const markdown = await fs.readFile(deckFile, 'utf8');
  if (/^routerMode:\s*hash\s*$/m.test(markdown)) return;

  if (/^---\n/.test(markdown)) {
    const updated = markdown.replace(/^---\n/, '---\nrouterMode: hash\n');
    await fs.writeFile(deckFile, updated, 'utf8');
    return;
  }

  await fs.writeFile(deckFile, `---\nrouterMode: hash\n---\n\n${markdown}`, 'utf8');
}

function runSlidev(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['--no-install', 'slidev', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      if (process.env.DEBUG) process.stderr.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (process.env.DEBUG) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Slidev exited with code ${code}`));
    });
  });
}
