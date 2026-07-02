import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Ensures that the expected v1 data directories exist.
 */
export async function ensureDataDirs(dataDir: string): Promise<void> {
  await Promise.all([
    fs.mkdir(path.join(dataDir, 'decks'), { recursive: true }),
    fs.mkdir(path.join(dataDir, 'exports'), { recursive: true }),
    fs.mkdir(path.join(dataDir, 'jobs'), { recursive: true }),
    fs.mkdir(path.join(dataDir, 'draft'), { recursive: true }),
    fs.mkdir(path.join(dataDir, 'published'), { recursive: true }),
    fs.mkdir(path.join(dataDir, 'auth'), { recursive: true }),
    fs.mkdir(path.join(dataDir, 'logs'), { recursive: true }),
  ]);
}

/**
 * Reads JSON from disk, returning a fallback for missing files.
 */
export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

/**
 * Reads required JSON from disk and maps missing files to a 404-style error.
 */
export async function readRequiredJson<T>(filePath: string, label: string): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw Object.assign(new Error(`${label} not found`), { statusCode: 404 });
    }
    throw error;
  }
}

/**
 * Writes JSON atomically enough for single-process server usage.
 */
export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

/**
 * Reads UTF-8 text from disk, returning a fallback for missing files.
 */
export async function readText(filePath: string, fallback = ''): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

/**
 * Reads required UTF-8 text from disk and maps missing files to a 404-style error.
 */
export async function readRequiredText(filePath: string, label: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw Object.assign(new Error(`${label} not found`), { statusCode: 404 });
    }
    throw error;
  }
}

/**
 * Writes UTF-8 text, creating parent directories first.
 */
export async function writeText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
}

/**
 * Narrows unknown errors to Node errors with optional code fields.
 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
