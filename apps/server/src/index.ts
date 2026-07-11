import http from 'node:http';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { toNodeHandler } from 'better-auth/node';
import { loadConfig, fallbackStaticDir } from './core/config.js';
import { sendError, serveStatic } from './core/http.js';
import { createApiRouter, handleDeckHostRequest } from './api/routes.js';
import { ensureDataDirs } from './core/storage.js';
import { AuthService } from './auth/auth.js';
import { createPgPool, runMigrations, setupLangGraphCheckpointer } from './db/db.js';
import { BETTER_AUTH_BASE_PATH, createBetterAuth } from './auth/betterAuth.js';
import { SettingsService } from './decks/settings.js';

/**
 * Starts the Deckhand v1 HTTP server.
 */
async function main(): Promise<void> {
  dotenv.config({ path: '.env' });
  if (process.env.SKIP_ENV_LOCAL !== 'true') {
    dotenv.config({ path: '.env.local', override: true });
  }
  const config = loadConfig();
  await ensureDataDirs(config.dataDir);
  await new SettingsService(config).apply();
  const pool = createPgPool(config);
  await runMigrations(config, pool);
  await setupLangGraphCheckpointer(config);
  await new AuthService(config, pool).bootstrap();

  const staticDirExists = await fs.stat(config.staticDir).then((stat) => stat.isDirectory()).catch(() => false);
  if (!staticDirExists) {
    config.staticDir = fallbackStaticDir(config);
  }

  const logLevel = process.env.LOG_LEVEL ?? 'info';
  const logFile = path.join(config.dataDir, 'logs', 'server.log');
  const logger = pino({ level: logLevel }, pino.multistream([
    { stream: process.stdout },
    { stream: createWriteStream(logFile, { flags: 'a' }) },
  ]));
  const api = createApiRouter(config, pool, logger.child({ component: 'api' }));
  const httpLogger = pinoHttp({ logger });
  const app = express();
  const betterAuthHandler = pool ? toNodeHandler(createBetterAuth(config, pool)) : null;

  app.disable('x-powered-by');
  app.use(httpLogger);
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.url.startsWith(BETTER_AUTH_BASE_PATH)) {
      next();
      return;
    }
    if (!betterAuthHandler) {
      res.status(503).json({
        error: 'better-auth requires DATABASE_URL',
        basePath: BETTER_AUTH_BASE_PATH,
      });
      return;
    }
    try {
      await betterAuthHandler(req, res);
    } catch (error) {
      req.log.error({ err: error }, 'better-auth request failed');
      if (!res.headersSent) sendError(res, error);
      else if (!res.writableEnded) res.end();
    }
  });
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (await handleDeckHostRequest(config, pool, req, res)) return;
      if (await api.handle(req, res)) return;
      next();
    } catch (error) {
      req.log.error({ err: error }, 'request failed');
      if (!res.headersSent) sendError(res, error);
      else if (!res.writableEnded) res.end();
    }
  });
  app.use(async (req: Request, res: Response) => {
    try {
      await serveStatic(config, req, res);
    } catch (error) {
      req.log.error({ err: error }, 'static request failed');
      if (!res.headersSent) sendError(res, error);
      else if (!res.writableEnded) res.end();
    }
  });

  const server = http.createServer(app);
  const sockets = new Set<import('node:net').Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error({
        host: config.host,
        port: config.port,
        hint: `Port ${config.port} is already in use. Stop the existing server or set PORT to another value.`,
      }, 'server listen failed');
    } else {
      logger.error({ err: error }, 'server error');
    }
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    const address = `http://${config.host}:${config.port}`;
    logger.info({ address, staticDir: config.staticDir, dataDir: config.dataDir }, 'Deckhand server listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals, restartAfterShutdown = false) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, restartAfterShutdown }, 'shutting down server');
    server.close(() => {
      void Promise.resolve(pool?.end())
        .finally(() => {
          if (restartAfterShutdown) process.kill(process.pid, signal);
          else process.exit(0);
        });
    });
    setTimeout(() => {
      logger.warn({ openSockets: sockets.size }, 'forcing server shutdown');
      sockets.forEach((socket) => socket.destroy());
    }, 2_000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGUSR2', () => shutdown('SIGUSR2', true));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
