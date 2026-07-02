import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, DeckRecord } from '../core/types.js';
import { DeckStore } from '../decks/decks.js';

/**
 * Runs the rough PPTX-to-Slidev converter and registers the result as a deck.
 */
export class ImportService {
  constructor(
    private readonly config: AppConfig,
    private readonly decks: DeckStore,
  ) {}

  async importPptx(input: { filename?: string; contentBase64?: string; title?: string; ownerUserId?: string }): Promise<DeckRecord> {
    const filename = sanitizeFilename(input.filename ?? 'upload.pptx');
    if (!filename.toLowerCase().endsWith('.pptx')) {
      throw Object.assign(new Error('Only .pptx uploads are supported'), { statusCode: 400 });
    }
    if (!input.contentBase64) {
      throw Object.assign(new Error('PPTX content is required'), { statusCode: 400 });
    }

    const buffer = decodeBase64(input.contentBase64);
    if (!buffer.length) throw Object.assign(new Error('PPTX content is empty'), { statusCode: 400 });
    if (buffer.byteLength > 20 * 1024 * 1024) {
      throw Object.assign(new Error('PPTX upload is too large'), { statusCode: 413 });
    }

    const importId = randomUUID();
    const importRoot = path.join(this.config.dataDir, 'imports', importId);
    const uploadPath = path.join(importRoot, filename);
    const projectDir = path.join(importRoot, 'project');
    await fs.mkdir(importRoot, { recursive: true });
    await fs.writeFile(uploadPath, buffer);

    try {
      const cliPath = path.join(this.config.repoRoot, 'dist', 'pptx-to-slidev', 'cli.js');
      await fs.access(cliPath).catch(() => {
        throw new Error('PPTX importer is not built. Run `npm run build` at the repository root before importing PPTX files.');
      });
      await runNode(this.config.repoRoot, [cliPath, uploadPath, '--out', projectDir], this.config.import.timeoutMs);
      return await this.decks.createFromProject({
        title: input.title ?? titleFromFilename(filename),
        projectDir,
        ownerUserId: input.ownerUserId,
        scaffoldKey: 'pptx-import',
      });
    } finally {
      await fs.rm(importRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function decodeBase64(value: string): Buffer {
  const raw = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  if (!/^[a-zA-Z0-9+/=\s_-]+$/.test(raw)) {
    throw Object.assign(new Error('Invalid PPTX content encoding'), { statusCode: 400 });
  }
  return Buffer.from(raw.replace(/\s/g, ''), 'base64');
}

function sanitizeFilename(value: string): string {
  const cleaned = path.basename(value).replace(/[^a-zA-Z0-9._-]/g, '-');
  return cleaned || 'upload.pptx';
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.pptx$/i, '').replace(/[-_]+/g, ' ').trim() || 'Imported PPTX deck';
}

function runNode(cwd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(Object.assign(new Error(`PPTX importer timed out after ${timeoutMs}ms`), { statusCode: 504 }));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Importer exited with code ${code}`));
    });
  });
}
