import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { AppConfig } from './types.js';
import { isNodeError } from './storage.js';

export interface JsonRequest extends http.IncomingMessage {
  body?: unknown;
  params: Record<string, string>;
  urlObject: URL;
}

export type RouteHandler = (req: JsonRequest, res: http.ServerResponse) => Promise<void> | void;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

/**
 * Small HTTP router with JSON body parsing and parameterized paths.
 */
export class Router {
  private readonly routes: Route[] = [];

  /**
   * Registers a method/path handler. Path parameters use `:name` syntax.
   */
  add(method: string, pathPattern: string, handler: RouteHandler): void {
    const keys: string[] = [];
    const pattern = new RegExp(`^${pathPattern.replace(/(:[^/]+|\*[^/]+)/g, (part) => {
      keys.push(part.slice(1));
      return part.startsWith('*') ? '(.+)' : '([^/]+)';
    })}$`);
    this.routes.push({ method: method.toUpperCase(), pattern, keys, handler });
  }

  /**
   * Dispatches a request to the first matching route.
   */
  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const urlObject = new URL(req.url ?? '/', 'http://localhost');
    const route = this.routes.find((candidate) => (
      candidate.method === (req.method ?? 'GET').toUpperCase()
      && candidate.pattern.test(urlObject.pathname)
    ));
    if (!route) return false;

    const match = urlObject.pathname.match(route.pattern);
    const jsonReq = req as JsonRequest;
    jsonReq.params = {};
    jsonReq.urlObject = urlObject;
    route.keys.forEach((key, index) => {
      jsonReq.params[key] = decodeURIComponent(match?.[index + 1] ?? '');
    });
    jsonReq.body = await readBody(req);
    await route.handler(jsonReq, res);
    return true;
  }
}

/**
 * Sends a JSON response with consistent headers.
 */
export function sendJson(res: http.ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Sends an HTML response.
 */
export function sendHtml(res: http.ServerResponse, value: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(value),
  });
  res.end(value);
}

/**
 * Sends a file inline without forcing attachment.
 */
export async function sendInlineFile(res: http.ServerResponse, filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  res.writeHead(200, {
    'content-type': contentType(filePath),
    'content-length': stat.size,
  });
  await pipeline(createReadStream(filePath), res);
}

/**
 * Sends an error response, honoring `statusCode` on thrown errors.
 */
export function sendError(res: http.ServerResponse, error: unknown): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const statusCode = getStatusCode(error);
  sendJson(res, statusCode, {
    error: error instanceof Error ? error.message : 'Internal server error',
  });
}

/**
 * Serves static files from a configured directory, falling back to `index.html`
 * for client-side routes.
 */
export async function serveStatic(config: AppConfig, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const urlObject = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(urlObject.pathname);
  const filePath = safeJoin(config.staticDir, pathname === '/' ? '/index.html' : pathname);
  const resolved = await resolveStaticPath(filePath, config.staticDir);

  if (!resolved) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  res.writeHead(200, { 'content-type': contentType(resolved) });
  await pipeline(createReadStream(resolved), res);
}

/**
 * Streams an export output file if the job succeeded.
 */
export async function sendFile(res: http.ServerResponse, filePath: string, downloadName: string): Promise<void> {
  const stat = await fs.stat(filePath);
  res.writeHead(200, {
    'content-type': contentType(filePath),
    'content-length': stat.size,
    'content-disposition': `attachment; filename="${downloadName.replace(/"/g, '')}"`,
  });
  await pipeline(createReadStream(filePath), res);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).byteLength > 30_000_000) {
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    }
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

async function resolveStaticPath(filePath: string, root: string): Promise<string | null> {
  const candidates = [filePath, path.join(root, 'index.html')];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

function safeJoin(root: string, requestPath: string): string {
  const resolved = path.resolve(root, `.${requestPath}`);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw Object.assign(new Error('Invalid static path'), { statusCode: 400 });
  }
  return resolved;
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  return types[extension] ?? 'application/octet-stream';
}

function getStatusCode(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) return statusCode;
  }
  if (isNodeError(error) && error.code === 'ENOENT') return 404;
  return 500;
}
