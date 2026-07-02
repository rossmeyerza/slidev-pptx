import type { AppConfig, DeckAgentSettings, DeckCollaboratorRecord, DeckRecord, ExportFormat, ExportJob, ShareRecord, ShareVisitorRecord, UserRecord, UserRole } from '../core/types.js';
import { DeckStore } from '../decks/decks.js';
import { ExportService } from '../export/exporter.js';
import { ImportService } from '../export/importer.js';
import http from 'node:http';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { Router, sendFile, sendHtml, sendInlineFile, sendJson, type JsonRequest } from '../core/http.js';
import { ShareService } from '../decks/share.js';
import { SlidevBuildService } from '../preview/slidevBuild.js';
import { AuthService } from '../auth/auth.js';
import { agentApiKey, agentRunConfig, runDeckEditAgent } from '../agent/agent.js';
import type { PgPool } from '../db/db.js';
import { CollaboratorService } from '../decks/collaborators.js';
import { ChatService } from '../decks/chat.js';
import { BETTER_AUTH_BASE_PATH } from '../auth/betterAuth.js';
import { AgentRunService } from '../agent/agentRuns.js';
import { formatSettings, SettingsService } from '../decks/settings.js';
import { AdminToolService } from '../decks/adminTools.js';
import { silentLogger, type ServiceLogger } from '../core/logger.js';

/**
 * Wires v1 JSON API routes for decks, sharing, publishing, and exports.
 */
export function createApiRouter(
  config: AppConfig,
  pool: PgPool | null = null,
  logger: ServiceLogger = silentLogger,
): Router {
  const decks = new DeckStore(config, pool);
  const shares = new ShareService(config, decks, pool);
  const collaborators = new CollaboratorService(config, pool);
  const chat = new ChatService(config, pool);
  const agentRuns = new AgentRunService(config, pool);
  const exports = new ExportService(config, decks, logger);
  const imports = new ImportService(config, decks);
  const slidev = new SlidevBuildService(config, decks);
  const auth = new AuthService(config, pool);
  const settings = new SettingsService(config);
  const adminTools = new AdminToolService(decks);
  const runtimeEvents = new RuntimeEventHub();
  const router = new Router();

  router.add('GET', '/api/health', (_req, res) => {
    sendJson(res, 200, { ok: true, service: 'slidev-agent-server' });
  });

  router.add('GET', '/api/auth/provider', (_req, res) => {
    sendJson(res, 200, {
      compatibilityAuth: true,
      bypass: config.auth.bypass,
      betterAuth: {
        enabled: Boolean(pool),
        basePath: BETTER_AUTH_BASE_PATH,
        plugins: ['magic-link', 'organization', 'admin'],
      },
      smtp: {
        enabled: Boolean(config.smtp),
      },
    });
  });

  router.add('GET', '/api/agent/runtime', async (req, res) => {
    await auth.requireUser(req);
    sendJson(res, 200, {
      runtime: 'deepagents',
      baseUrl: config.agent.baseUrl,
      memberModel: config.agent.memberModel,
      adminModel: config.agent.adminModel,
      langgraph: {
        enabled: Boolean(config.database.url),
        schema: config.database.langgraphSchema,
      },
    });
  });

  router.add('GET', '/api/admin/settings', async (req, res) => {
    await auth.requireAdmin(req);
    sendJson(res, 200, formatSettings(config, await settings.load()));
  });

  router.add('GET', '/api/admin/agent-models', async (req, res) => {
    await auth.requireAdmin(req);
    const baseUrl = optionalString(req.urlObject.searchParams.get('baseUrl') ?? undefined)?.trim().replace(/\/$/, '') || config.agent.baseUrl;
    const models = await fetchModelProviderModels(config, baseUrl);
    sendJson(res, 200, { baseUrl, models });
  });

  router.add('PATCH', '/api/admin/settings', async (req, res) => {
    await auth.requireAdmin(req);
    const body = asObject(req.body);
    const scaffoldSettings = asOptionalObject(body.scaffolds);
    await validateScaffoldSettings(decks, scaffoldSettings);
    const persisted = await settings.update({
      agent: asOptionalObject(body.agent),
      scaffolds: scaffoldSettings,
    });
    sendJson(res, 200, formatSettings(config, persisted));
  });

  router.add('GET', '/api/decks/:id/agent-settings', async (req, res) => {
    const context = await auth.requireAdmin(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const deck = await decks.get(req.params.id);
    sendJson(res, 200, { agent: formatDeckAgentSettings(config, deck.meta.agent) });
  });

  router.add('PATCH', '/api/decks/:id/agent-settings', async (req, res) => {
    const context = await auth.requireAdmin(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    const body = asObject(req.body);
    const agent = normalizeDeckAgentSettings(config, asOptionalObject(body.agent));
    const meta = await decks.updateMeta(req.params.id, { agent });
    sendJson(res, 200, { agent: formatDeckAgentSettings(config, meta.agent) });
  });

  router.add('GET', '/internal/tls-check', async (req, res) => {
    const domain = req.urlObject.searchParams.get('domain') ?? req.headers.host ?? '';
    const deckId = deckIdFromHost(config, domain);
    if (!deckId) {
      sendJson(res, 404, { ok: false });
      return;
    }
    try {
      await decks.get(deckId);
    } catch {
      sendJson(res, 404, { ok: false });
      return;
    }
    sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/auth/me', async (req, res) => {
    const context = await auth.currentUser(req);
    sendJson(res, 200, { user: context?.user ?? null, hasUsers: (await auth.listUsers()).length > 0 });
  });

  router.add('POST', '/api/auth/bootstrap', async (req, res) => {
    const body = asObject(req.body);
    const users = await auth.listUsers();
    if (users.length) throw Object.assign(new Error('Bootstrap admin already exists'), { statusCode: 409 });
    const result = await auth.inviteUser({
      email: requiredString(body.email, 'email'),
      name: optionalString(body.name),
      role: 'admin',
      createdByUserId: 'bootstrap',
    });
    sendJson(res, 201, result);
  });

  router.add('POST', '/api/auth/login', async (req, res) => {
    const body = asObject(req.body);
    sendJson(res, 200, await auth.requestLogin({ email: requiredString(body.email, 'email') }));
  });

  router.add('GET', '/auth/callback', async (req, res) => {
    const token = req.urlObject.searchParams.get('token');
    if (!token) throw Object.assign(new Error('Token is required'), { statusCode: 400 });
    const result = await auth.consumeToken(token);
    res.setHeader('set-cookie', await auth.sessionCookie(result.sessionToken, result.session));
    res.writeHead(302, { location: '/' });
    res.end();
  });

  router.add('POST', '/api/auth/logout', async (req, res) => {
    await auth.logout(req);
    res.setHeader('set-cookie', auth.clearCookie());
    sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/users', async (req, res) => {
    await auth.requireAdmin(req);
    sendJson(res, 200, { users: await auth.listUsers() });
  });

  router.add('POST', '/api/users/invite', async (req, res) => {
    const context = await auth.requireAdmin(req);
    const body = asObject(req.body);
    const role = optionalRole(body.role) ?? 'employee';
    sendJson(res, 201, await auth.inviteUser({
      email: requiredString(body.email, 'email'),
      name: optionalString(body.name),
      role,
      createdByUserId: context.user.id,
    }));
  });

  router.add('PATCH', '/api/users/:id', async (req, res) => {
    await auth.requireAdmin(req);
    const body = asObject(req.body);
    const user = await auth.updateUser(req.params.id, {
      name: optionalString(body.name),
      role: optionalRole(body.role),
      status: optionalUserStatus(body.status),
    });
    sendJson(res, 200, { user });
  });

  router.add('GET', '/vendor/halfmoon/halfmoon.min.css', async (_req, res) => {
    await sendInlineFile(res, path.join(config.repoRoot, 'node_modules', 'halfmoon', 'css', 'halfmoon.min.css'));
  });

  router.add('GET', '/api/decks', async (req, res) => {
    const context = await auth.requireUser(req);
    const items = await Promise.all((await decksVisibleToUser(decks, collaborators, context.user)).map(async (deck) => ({
      ...deck,
      previewUrl: normalizeDraftDeckUrl(deck.id, deck.draftUrl),
      publishedUrl: normalizePublishedDeckUrl(deck.id, deck.publishUrl),
      shares: (await shares.sharesForDeck(deck.id)).map(formatShare),
    })));
    sendJson(res, 200, { decks: items });
  });

  router.add('GET', '/api/scaffolds', async (req, res) => {
    const context = await auth.requireUser(req);
    sendJson(res, 200, { scaffolds: await decks.listScaffolds({ userRole: context.user.role }) });
  });

  router.add('POST', '/api/decks', async (req, res) => {
    const context = await auth.requireUser(req);
    const body = asObject(req.body);
    await decks.assertScaffoldAvailable(optionalString(body.scaffold) ?? config.scaffoldKey, context.user.role);
    const deck = await decks.create({
      title: optionalString(body.title),
      markdown: optionalString(body.markdown),
      scaffold: optionalString(body.scaffold),
      ownerUserId: context.user.id,
    });
    scheduleDraftBuildIfNeeded(slidev, deck);
    sendJson(res, 201, await formatDeck(deck, await shares.sharesForDeck(deck.meta.id), chat, slidev));
  });

  router.add('POST', '/api/imports/pptx', async (req, res) => {
    const context = await auth.requireUser(req);
    const body = asObject(req.body);
    const deck = await imports.importPptx({
      filename: optionalString(body.filename),
      contentBase64: requiredString(body.contentBase64, 'contentBase64'),
      title: optionalString(body.title),
      ownerUserId: context.user.id,
    });
    scheduleDraftBuild(slidev, deck.meta.id);
    sendJson(res, 201, await formatDeck(deck, await shares.sharesForDeck(deck.meta.id), chat, slidev));
  });

  router.add('GET', '/api/decks/:id', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const deck = await decks.get(req.params.id);
    sendJson(res, 200, await formatDeck(deck, await shares.sharesForDeck(req.params.id), chat, slidev));
  });

  router.add('PUT', '/api/decks/:id', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    await decks.requireEditLock(req.params.id, context.user.id);
    const body = asObject(req.body);
    const deck = await decks.update(req.params.id, {
      title: optionalString(body.title),
      markdown: optionalString(body.markdown),
    });
    runtimeEvents.emit(deck.meta.id);
    scheduleDraftBuildIfNeeded(slidev, deck);
    sendJson(res, 200, await formatDeck(deck, await shares.sharesForDeck(req.params.id), chat, slidev));
  });

  router.add('POST', '/api/decks/:id/instructions', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    await decks.requireEditLock(req.params.id, context.user.id);
    const deck = await recordInstruction(config, decks, chat, agentRuns, req.params.id, asObject(req.body), context.user);
    runtimeEvents.emit(deck.meta.id);
    scheduleDraftBuildIfNeeded(slidev, deck);
    sendJson(res, 200, await formatDeck(deck, await shares.sharesForDeck(req.params.id), chat, slidev));
  });

  router.add('POST', '/api/decks/:id/chat', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    await decks.requireEditLock(req.params.id, context.user.id);
    const deck = await recordInstruction(config, decks, chat, agentRuns, req.params.id, asObject(req.body), context.user);
    runtimeEvents.emit(deck.meta.id);
    scheduleDraftBuildIfNeeded(slidev, deck);
    sendJson(res, 200, await formatDeck(deck, await shares.sharesForDeck(req.params.id), chat, slidev));
  });

  router.add('POST', '/api/decks/:id/messages', async (req, res) => {
    const context = await auth.requireUser(req);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    try {
      await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
      await decks.requireEditLock(req.params.id, context.user.id);
      sendSse(res, 'status', { status: 'running' });
      const deck = await recordInstruction(config, decks, chat, agentRuns, req.params.id, asObject(req.body), context.user, (event, data) => {
        sendSse(res, event, data);
      });
      runtimeEvents.emit(deck.meta.id);
      scheduleDraftBuildIfNeeded(slidev, deck);
      sendSse(res, 'done', { deck: await formatDeck(deck, await shares.sharesForDeck(req.params.id), chat, slidev) });
    } catch (error) {
      sendSse(res, 'error', { error: error instanceof Error ? error.message : 'Instruction failed' });
    } finally {
      res.end();
    }
  });

  router.add('GET', '/api/decks/:id/runs', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    sendJson(res, 200, { runs: await agentRuns.list(req.params.id) });
  });

  router.add('GET', '/api/decks/:id/preview-build', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    sendJson(res, 200, { previewBuild: await slidev.status(req.params.id, 'draft') });
  });

  router.add('POST', '/api/decks/:id/runs/:runId/cancel', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    await decks.requireEditLock(req.params.id, context.user.id);
    const run = await agentRuns.cancel(req.params.runId);
    sendJson(res, 200, { run });
  });

  router.add('POST', '/api/decks/:id/lock', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    const meta = await decks.acquireEditLock(req.params.id, context.user.id);
    const deck = await decks.get(meta.id);
    sendJson(res, 200, await formatDeck(deck, await shares.sharesForDeck(req.params.id), chat));
  });

  router.add('DELETE', '/api/decks/:id/lock', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const meta = await decks.releaseEditLock(req.params.id, context.user.id);
    const deck = await decks.get(meta.id);
    sendJson(res, 200, await formatDeck(deck, await shares.sharesForDeck(req.params.id), chat));
  });

  router.add('POST', '/api/decks/:id/live', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const deck = await decks.get(req.params.id);
    if (isCustomRuntimeDeck(deck)) {
      sendJson(res, 200, { preview: customRuntimePreview(deck.meta.id) });
      return;
    }
    scheduleDraftBuild(slidev, deck.meta.id);
    sendJson(res, 200, { preview: draftBuildPreview(config, deck.meta.id) });
  });

  router.add('POST', '/api/decks/:id/admin-tools/components', async (req, res) => {
    const context = await auth.requireAdmin(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    const body = asObject(req.body);
    const file = await adminTools.createComponent(req.params.id, {
      name: requiredString(body.name, 'name'),
      source: optionalString(body.source),
    });
    runtimeEvents.emit(req.params.id);
    scheduleDraftBuild(slidev, req.params.id);
    sendJson(res, 201, { file });
  });

  router.add('POST', '/api/decks/:id/admin-tools/layouts', async (req, res) => {
    const context = await auth.requireAdmin(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    const body = asObject(req.body);
    const file = await adminTools.createLayout(req.params.id, {
      name: requiredString(body.name, 'name'),
      source: optionalString(body.source),
    });
    runtimeEvents.emit(req.params.id);
    scheduleDraftBuild(slidev, req.params.id);
    sendJson(res, 201, { file });
  });

  router.add('POST', '/api/decks/:id/admin-tools/dependencies', async (req, res) => {
    const context = await auth.requireAdmin(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    const body = asObject(req.body);
    const dependency = await adminTools.addDependency(req.params.id, {
      name: requiredString(body.name, 'name'),
      version: optionalString(body.version),
      install: body.install === true,
    });
    runtimeEvents.emit(req.params.id);
    scheduleDraftBuild(slidev, req.params.id);
    sendJson(res, 200, { dependency });
  });

  router.add('POST', '/api/decks/:id/admin-tools/restart-preview', async (req, res) => {
    const context = await auth.requireAdmin(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    scheduleDraftBuild(slidev, req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.add('DELETE', '/api/decks/:id', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    await decks.delete(req.params.id);
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', '/api/decks/:id/share', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    const body = asObject(req.body);
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;
    const share = await shares.share(req.params.id, {
      enabled,
      name: optionalString(body.name),
      email: optionalString(body.email),
      permission: body.permission === 'edit' ? 'edit' : 'view',
      password: optionalString(body.password),
      createdByUserId: context.user.id,
    });
    sendJson(res, 200, { share: formatShare(share) });
  });

  router.add('POST', '/api/decks/:id/shares', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    const body = asObject(req.body);
    const share = await shares.share(req.params.id, {
      name: optionalString(body.name),
      email: optionalString(body.email),
      permission: body.permission === 'edit' ? 'edit' : 'view',
      password: optionalString(body.password),
      createdByUserId: context.user.id,
    });
    sendJson(res, 200, { share: formatShare(share) });
  });

  router.add('DELETE', '/api/decks/:id/shares/:shareId', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    await shares.revoke(req.params.id, req.params.shareId);
    sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/decks/:id/collaborators', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    sendJson(res, 200, { collaborators: await formatCollaborators(auth, await collaborators.list(req.params.id)) });
  });

  router.add('POST', '/api/decks/:id/collaborators', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    const body = asObject(req.body);
    const user = await resolveCollaboratorUser(auth, body);
    if (user.id === context.user.id) {
      throw Object.assign(new Error('You already own or can edit this deck'), { statusCode: 400 });
    }
    const collaborator = await collaborators.upsert({
      deckId: req.params.id,
      userId: user.id,
      role: body.role === 'viewer' ? 'viewer' : 'editor',
    });
    sendJson(res, 200, { collaborator: (await formatCollaborators(auth, [collaborator]))[0] });
  });

  router.add('DELETE', '/api/decks/:id/collaborators/:userId', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    await collaborators.remove(req.params.id, req.params.userId);
    sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/share/:token', async (req, res) => {
    const share = await shares.getShare(req.params.token);
    const passwordSatisfied = await shares.isPasswordSatisfied(req.params.token, readCookie(req.headers.cookie ?? '', sharePasswordCookieName(req.params.token)));
    if (!passwordSatisfied) {
      sendJson(res, 200, {
        share: formatShare(share),
        passwordRequired: true,
        visitorRequired: false,
      });
      return;
    }
    const deck = await shares.getSharedDeck(req.params.token);
    const visitor = await shares.visitorForShare(req.params.token, readCookie(req.headers.cookie ?? '', shareVisitorCookieName(req.params.token)));
    sendJson(res, 200, {
      ...(await formatDeck(deck, [], chat)),
      share: formatShare(share),
      visitor,
      passwordRequired: false,
      visitorRequired: share.permission === 'edit' && !visitor,
    });
  });

  router.add('POST', '/api/share/:token/password', async (req, res) => {
    const body = asObject(req.body);
    const value = await shares.verifyPassword(req.params.token, optionalString(body.password));
    res.setHeader('set-cookie', sharePasswordCookie(req.params.token, value));
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', '/api/share/:token/visitor', async (req, res) => {
    const access = await shareVisitorAccess(shares, req);
    if (!access.passwordSatisfied) {
      throw Object.assign(new Error('Share password is required'), { statusCode: 401 });
    }
    const body = asObject(req.body);
    const visitor = await shares.identifyVisitor(req.params.token, {
      name: optionalString(body.name),
      email: optionalString(body.email),
    });
    res.setHeader('set-cookie', shareVisitorCookie(req.params.token, visitor.id));
    sendJson(res, 200, { visitor });
  });

  router.add('POST', '/api/share/:token/instructions', async (req, res) => {
    const { share, visitor } = await requireShareEditVisitor(shares, req);
    const deck = await shares.getSharedDeck(req.params.token);
    const body = withShareVisitorInstruction(asObject(req.body), visitor);
    const updated = await recordInstruction(config, decks, chat, agentRuns, deck.meta.id, body, shareVisitorUser(visitor));
    runtimeEvents.emit(updated.meta.id);
    scheduleDraftBuildIfNeeded(slidev, updated);
    sendJson(res, 200, {
      ...(await formatDeck(updated, [], chat, slidev)),
      previewUrl: `/share/${encodeURIComponent(req.params.token)}/deck/#/1`,
      share: formatShare(share),
      visitor,
    });
  });

  router.add('GET', '/share/:token', async (req, res) => {
    const access = await shareVisitorAccess(shares, req);
    if (sendShareVisitorGateIfNeeded(access, req, res)) return;
    const deck = await shares.getSharedDeck(req.params.token);
    if (access.share.permission === 'edit' && access.visitor) {
      sendHtml(res, shareEditWorkbenchHtml(req.params.token, deck.meta.title, access.visitor));
      return;
    }
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'draft');
    await sendInlineFile(res, path.join(outDir, 'index.html'));
  });

  router.add('GET', '/share/:token/', async (req, res) => {
    const access = await shareVisitorAccess(shares, req);
    if (sendShareVisitorGateIfNeeded(access, req, res)) return;
    const deck = await shares.getSharedDeck(req.params.token);
    if (access.share.permission === 'edit' && access.visitor) {
      sendHtml(res, shareEditWorkbenchHtml(req.params.token, deck.meta.title, access.visitor));
      return;
    }
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'draft');
    await sendInlineFile(res, path.join(outDir, 'index.html'));
  });

  router.add('GET', '/share/:token/deck', async (req, res) => {
    const access = await shareVisitorAccess(shares, req);
    if (sendShareVisitorGateIfNeeded(access, req, res)) return;
    const deck = await shares.getSharedDeck(req.params.token);
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'draft');
    await sendInlineFile(res, path.join(outDir, 'index.html'));
  });

  router.add('GET', '/share/:token/deck/', async (req, res) => {
    const access = await shareVisitorAccess(shares, req);
    if (sendShareVisitorGateIfNeeded(access, req, res)) return;
    const deck = await shares.getSharedDeck(req.params.token);
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'draft');
    await sendInlineFile(res, path.join(outDir, 'index.html'));
  });

  router.add('GET', '/share/:token/deck/*path', async (req, res) => {
    const access = await shareVisitorAccess(shares, req);
    if (sendShareVisitorGateIfNeeded(access, req, res)) return;
    const deck = await shares.getSharedDeck(req.params.token);
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'draft');
    await sendSlidevStatic(res, outDir, req.params.path);
  });

  router.add('GET', '/share/:token/*path', async (req, res) => {
    const access = await shareVisitorAccess(shares, req);
    if (sendShareVisitorGateIfNeeded(access, req, res)) return;
    const deck = await shares.getSharedDeck(req.params.token);
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'draft');
    await sendSlidevStatic(res, outDir, req.params.path);
  });

  router.add('POST', '/api/decks/:id/publish', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'edit');
    const body = asObject(req.body);
    await slidev.build(req.params.id, 'published');
    const publish = await shares.publish(req.params.id, optionalString(body.channel) ?? 'local');
    const deck = await decks.get(req.params.id);
    sendJson(res, 200, { publish, deck: await formatDeck(deck, await shares.sharesForDeck(req.params.id), chat) });
  });

  router.add('POST', '/api/decks/:id/export', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const body = asObject(req.body);
    const job = await exports.start(req.params.id, {
      format: optionalExportFormat(body.format),
      mode: optionalString(body.mode),
    });
    sendJson(res, 202, { export: job });
  });

  router.add('POST', '/api/decks/:id/export/pptx', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const body = asObject(req.body);
    const job = await exports.start(req.params.id, {
      format: 'pptx',
      mode: optionalString(body.mode),
    });
    sendJson(res, 202, { export: job });
  });

  router.add('GET', '/api/exports/:id', async (req, res) => {
    const context = await auth.requireUser(req);
    const job = await exports.get(req.params.id);
    await requireDeckAccess(decks, collaborators, job.deckId, context.user, 'view');
    sendJson(res, 200, job);
  });

  router.add('GET', '/api/exports/:id/download', async (req, res) => {
    const context = await auth.requireUser(req);
    const job = await exports.get(req.params.id);
    await requireDeckAccess(decks, collaborators, job.deckId, context.user, 'view');
    assertDownloadable(job);
    await sendFile(res, job.outputPath, `deck-${job.id}.${job.format === 'pptx' ? 'pptx' : 'md'}`);
  });

  router.add('GET', '/api/decks/:id/runtime/events', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    runtimeEvents.register(req.params.id, res);
  });

  router.add('GET', '/draft/:id', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const deck = await decks.get(req.params.id);
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'draft');
    await sendInlineFile(res, path.join(outDir, 'index.html'));
  });

  router.add('GET', '/draft/:id/', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const deck = await decks.get(req.params.id);
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'draft');
    await sendInlineFile(res, path.join(outDir, 'index.html'));
  });

  router.add('GET', '/draft/:id/*path', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const outDir = await slidev.ensureBuilt(req.params.id, 'draft');
    await sendSlidevStatic(res, outDir, req.params.path);
  });

  router.add('GET', '/runtime/:id', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    res.writeHead(302, { location: `/runtime/${encodeURIComponent(req.params.id)}/#/1` });
    res.end();
  });

  router.add('GET', '/runtime/:id/', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    await sendRuntimeFile(res, decks.deckPath(req.params.id), 'index.html');
  });

  router.add('GET', '/runtime/:id/*path', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    await sendRuntimeFile(res, decks.deckPath(req.params.id), runtimeRequestPath(req.params.path));
  });

  router.add('GET', '/published/:id', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const deck = await decks.get(req.params.id);
    if (deck.meta.status !== 'published') {
      throw Object.assign(new Error('Deck is not published'), { statusCode: 404 });
    }
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'published');
    await sendInlineFile(res, path.join(outDir, 'index.html'));
  });

  router.add('GET', '/published/:id/', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const deck = await decks.get(req.params.id);
    if (deck.meta.status !== 'published') {
      throw Object.assign(new Error('Deck is not published'), { statusCode: 404 });
    }
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'published');
    await sendInlineFile(res, path.join(outDir, 'index.html'));
  });

  router.add('GET', '/published/:id/*path', async (req, res) => {
    const context = await auth.requireUser(req);
    await requireDeckAccess(decks, collaborators, req.params.id, context.user, 'view');
    const deck = await decks.get(req.params.id);
    if (deck.meta.status !== 'published') {
      throw Object.assign(new Error('Deck is not published'), { statusCode: 404 });
    }
    const outDir = await slidev.ensureBuilt(deck.meta.id, 'published');
    await sendSlidevStatic(res, outDir, req.params.path);
  });

  return router;
}

export async function handleDeckHostRequest(
  config: AppConfig,
  pool: PgPool | null,
  req: http.IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const deckId = deckIdFromHost(config, req.headers.host);
  if (!deckId) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const urlObject = new URL(req.url ?? '/', 'http://localhost');
  const jsonReq = req as JsonRequest;
  jsonReq.params = { id: deckId };
  jsonReq.urlObject = urlObject;

  const auth = new AuthService(config, pool);
  const context = await auth.requireUser(jsonReq);
  const decks = new DeckStore(config, pool);
  const collaborators = new CollaboratorService(config, pool);
  await requireDeckAccess(decks, collaborators, deckId, context.user, 'view');

  const slidev = new SlidevBuildService(config, decks);
  const deck = await decks.get(deckId);
  const mode = deck.meta.status === 'published' ? 'published' : 'draft';
  const outDir = await slidev.ensureBuilt(deckId, mode);
  if (urlObject.pathname === '/' || urlObject.pathname === '') {
    await sendInlineFile(res, path.join(outDir, 'index.html'));
    return true;
  }
  await sendSlidevStatic(res, outDir, urlObject.pathname.replace(/^\//, ''));
  return true;
}

async function decksVisibleToUser(decks: DeckStore, collaborators: CollaboratorService, user: UserRecord) {
  const allDecks = await decks.list();
  if (user.role === 'admin') return allDecks;
  const visible = [];
  for (const deck of allDecks) {
    if (await canAccessDeck(decks, collaborators, deck.id, user, 'view')) visible.push(deck);
  }
  return visible;
}

async function requireDeckAccess(decks: DeckStore, collaborators: CollaboratorService, deckId: string, user: UserRecord, need: 'view' | 'edit'): Promise<void> {
  if (await canAccessDeck(decks, collaborators, deckId, user, need)) return;
  throw Object.assign(new Error('Deck access denied'), { statusCode: 403 });
}

async function canAccessDeck(decks: DeckStore, collaborators: CollaboratorService, deckId: string, user: UserRecord, need: 'view' | 'edit'): Promise<boolean> {
  const deck = await decks.get(deckId);
  const configuredOrgId = await decks.configuredOrgId();
  if (configuredOrgId && deck.meta.orgId && deck.meta.orgId !== configuredOrgId) return false;
  if (user.role === 'admin') return true;
  if (!deck.meta.ownerUserId) return true;
  if (deck.meta.ownerUserId === user.id) return true;
  const role = await collaborators.roleFor(deckId, user.id);
  if (need === 'view') return role === 'viewer' || role === 'editor';
  return role === 'editor';
}

interface ShareVisitorAccess {
  share: ShareRecord;
  visitor: ShareVisitorRecord | null;
  passwordSatisfied: boolean;
}

async function shareVisitorAccess(shares: ShareService, req: JsonRequest): Promise<ShareVisitorAccess> {
  const share = await shares.getShare(req.params.token);
  const passwordSatisfied = await shares.isPasswordSatisfied(req.params.token, readCookie(req.headers.cookie ?? '', sharePasswordCookieName(req.params.token)));
  const visitor = await shares.visitorForShare(req.params.token, readCookie(req.headers.cookie ?? '', shareVisitorCookieName(req.params.token)));
  return { share, visitor, passwordSatisfied };
}

async function requireShareEditVisitor(shares: ShareService, req: JsonRequest): Promise<{ share: ShareRecord; visitor: ShareVisitorRecord }> {
  const access = await shareVisitorAccess(shares, req);
  if (access.share.permission !== 'edit') {
    throw Object.assign(new Error('Share link is view-only'), { statusCode: 403 });
  }
  if (!access.passwordSatisfied) {
    throw Object.assign(new Error('Share password is required'), { statusCode: 401 });
  }
  if (!access.visitor) {
    throw Object.assign(new Error('Visitor identity is required'), { statusCode: 401 });
  }
  return { share: access.share, visitor: access.visitor };
}

function sendShareVisitorGateIfNeeded(access: ShareVisitorAccess, req: JsonRequest, res: ServerResponse): boolean {
  if (!access.passwordSatisfied) {
    sendHtml(res, sharePasswordGateHtml(req.params.token, access.share.name));
    return true;
  }
  if (access.share.permission !== 'edit') return false;
  if (access.visitor) return false;
  sendHtml(res, shareVisitorGateHtml(req.params.token, access.share.name, access.share.email));
  return true;
}

function sharePasswordGateHtml(token: string, name: string): string {
  const shareUrl = `/share/${encodeURIComponent(token)}/#/1`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Share password required</title>
    <link rel="stylesheet" href="/vendor/halfmoon/halfmoon.min.css">
  </head>
  <body>
    <main class="container py-5">
      <section class="card shadow-sm col-12 col-lg-5 mx-auto">
        <div class="card-header">
          <h1 class="h4 mb-1">Share password required</h1>
          <p class="text-body-secondary mb-0">This deck link for ${escapeHtml(name)} is password protected.</p>
        </div>
        <form class="card-body" id="passwordForm">
          <div class="mb-3">
            <label class="form-label" for="sharePassword">Password</label>
            <input class="form-control" id="sharePassword" name="password" type="password" autocomplete="current-password" required>
          </div>
          <div class="alert alert-danger d-none" id="passwordError" role="alert"></div>
          <button class="btn btn-primary" type="submit">Continue</button>
        </form>
      </section>
    </main>
    <script>
      document.getElementById('passwordForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const error = document.getElementById('passwordError');
        error.classList.add('d-none');
        const form = new FormData(event.currentTarget);
        const response = await fetch('/api/share/${encodeURIComponent(token)}/password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: form.get('password') }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          error.textContent = payload.error || 'Could not continue.';
          error.classList.remove('d-none');
          return;
        }
        window.location.href = ${JSON.stringify(shareUrl)};
      });
    </script>
  </body>
</html>`;
}

function shareVisitorGateHtml(token: string, name: string, email: string): string {
  const shareUrl = `/share/${encodeURIComponent(token)}/#/1`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Identify yourself</title>
    <link rel="stylesheet" href="/vendor/halfmoon/halfmoon.min.css">
  </head>
  <body>
    <main class="container py-5">
      <section class="card shadow-sm col-12 col-lg-5 mx-auto">
        <div class="card-header">
          <h1 class="h4 mb-1">Identify yourself</h1>
          <p class="text-body-secondary mb-0">This editable deck link was shared with ${escapeHtml(name)}${email ? ` (${escapeHtml(email)})` : ''}.</p>
        </div>
        <form class="card-body" id="visitorForm">
          <div class="mb-3">
            <label class="form-label" for="visitorName">Name</label>
            <input class="form-control" id="visitorName" name="name" autocomplete="name" required>
          </div>
          <div class="mb-3">
            <label class="form-label" for="visitorEmail">Email</label>
            <input class="form-control" id="visitorEmail" name="email" type="email" autocomplete="email" required>
          </div>
          <div class="alert alert-danger d-none" id="visitorError" role="alert"></div>
          <button class="btn btn-primary" type="submit">Continue</button>
        </form>
      </section>
    </main>
    <script>
      document.getElementById('visitorForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const error = document.getElementById('visitorError');
        error.classList.add('d-none');
        const form = new FormData(event.currentTarget);
        const response = await fetch('/api/share/${encodeURIComponent(token)}/visitor', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: form.get('name'), email: form.get('email') }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          error.textContent = payload.error || 'Could not continue.';
          error.classList.remove('d-none');
          return;
        }
        window.location.href = ${JSON.stringify(shareUrl)};
      });
    </script>
  </body>
</html>`;
}

function shareEditWorkbenchHtml(token: string, title: string, visitor: ShareVisitorRecord): string {
  const encodedToken = encodeURIComponent(token);
  const deckUrl = `/share/${encodedToken}/deck/#/1`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} client workbench</title>
    <link rel="stylesheet" href="/vendor/halfmoon/halfmoon.min.css">
  </head>
  <body>
    <main class="container-fluid py-3">
      <div class="d-flex align-items-center justify-content-between gap-3 mb-3">
        <div>
          <h1 class="h4 mb-1">${escapeHtml(title)}</h1>
          <p class="text-body-secondary mb-0">Editing as ${escapeHtml(visitor.name)} (${escapeHtml(visitor.email)})</p>
        </div>
        <a class="btn btn-secondary" href="${deckUrl}" target="_blank" rel="noreferrer">Open deck</a>
      </div>
      <div class="row g-3">
        <section class="col-12 col-xl-8">
          <div class="ratio ratio-16x9 border rounded">
            <iframe id="deckFrame" src="${deckUrl}" title="${escapeHtml(title)} preview"></iframe>
          </div>
        </section>
        <aside class="col-12 col-xl-4">
          <form class="card shadow-sm" id="instructionForm">
            <div class="card-header">
              <h2 class="h5 mb-1">Client workbench</h2>
              <p class="text-body-secondary mb-0">Request focused changes to this draft deck.</p>
            </div>
            <div class="card-body">
              <label class="form-label" for="instruction">Instruction</label>
              <textarea class="form-control mb-3" id="instruction" rows="10" required></textarea>
              <div class="alert alert-danger d-none" id="instructionError" role="alert"></div>
              <div class="alert alert-success d-none" id="instructionSuccess" role="status"></div>
              <button class="btn btn-primary" id="sendInstruction" type="submit">Send change</button>
            </div>
          </form>
        </aside>
      </div>
    </main>
    <script>
      const token = ${JSON.stringify(token)};
      const deckUrl = ${JSON.stringify(deckUrl)};
      const form = document.getElementById('instructionForm');
      const textarea = document.getElementById('instruction');
      const button = document.getElementById('sendInstruction');
      const frame = document.getElementById('deckFrame');
      const error = document.getElementById('instructionError');
      const success = document.getElementById('instructionSuccess');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.classList.add('d-none');
        success.classList.add('d-none');
        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = 'Sending...';
        try {
          const response = await fetch('/api/share/' + encodeURIComponent(token) + '/instructions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ instruction: textarea.value }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || 'Could not apply the change.');
          textarea.value = '';
          success.textContent = 'Change applied. Preview refreshed.';
          success.classList.remove('d-none');
          frame.src = deckUrl.split('#')[0] + '?t=' + Date.now() + '#/1';
        } catch (caught) {
          error.textContent = caught instanceof Error ? caught.message : 'Could not apply the change.';
          error.classList.remove('d-none');
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }
      });
    </script>
  </body>
</html>`;
}

function shareVisitorCookieName(token: string): string {
  return `slidev_share_${token.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function sharePasswordCookieName(token: string): string {
  return `slidev_share_pw_${token.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function shareVisitorCookie(token: string, visitorId: string): string {
  return `${shareVisitorCookieName(token)}=${encodeURIComponent(visitorId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`;
}

function sharePasswordCookie(token: string, value: string): string {
  return `${sharePasswordCookieName(token)}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`;
}

function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function formatDeck(
  deck: Awaited<ReturnType<DeckStore['get']>>,
  deckShares: Awaited<ReturnType<ShareService['sharesForDeck']>>,
  chat: ChatService,
  slidev?: SlidevBuildService,
) {
  const messages = await chat.list(deck.meta.id);
  return {
    ...deck.meta,
    markdown: deck.markdown,
    previewUrl: normalizeDraftDeckUrl(deck.meta.id, deck.meta.draftUrl),
    publishedUrl: normalizePublishedDeckUrl(deck.meta.id, deck.meta.publishUrl),
    shares: deckShares.map(formatShare),
    messages: messages.length ? messages : deck.meta.messages ?? [],
    agent: formatDeckAgentSettings(undefined, deck.meta.agent),
    pptx: deck.meta.pptx,
    previewBuild: slidev ? await slidev.status(deck.meta.id, 'draft') : undefined,
  };
}

function scheduleDraftBuild(slidev: SlidevBuildService, deckId: string): void {
  slidev.buildInBackground(deckId, 'draft');
}

function scheduleDraftBuildIfNeeded(slidev: SlidevBuildService, deck: DeckRecord): void {
  if (isCustomRuntimeDeck(deck)) return;
  scheduleDraftBuild(slidev, deck.meta.id);
}

function isCustomRuntimeDeck(deck: DeckRecord): boolean {
  return deck.meta.scaffoldKey === 'custom-html';
}

function customRuntimePreview(deckId: string) {
  return {
    deckId,
    url: `/runtime/${deckId}/#/1`,
    status: 'running',
    startedAt: new Date().toISOString(),
    lastActivityAt: Date.now(),
    restartAttempts: 0,
  };
}

function draftBuildPreview(config: AppConfig, deckId: string) {
  const url = config.decksDomain
    ? `${config.publicBaseUrl.startsWith('https://') ? 'https' : 'http'}://${deckId}.${config.decksDomain}/#/1`
    : draftDeckUrl(deckId);
  return {
    deckId,
    url,
    status: 'draft',
    startedAt: new Date().toISOString(),
    lastActivityAt: Date.now(),
    restartAttempts: 0,
  };
}

function formatDeckAgentSettings(config?: AppConfig, agent?: DeckAgentSettings) {
  return {
    baseUrl: agent?.baseUrl ?? config?.agent.baseUrl ?? '',
    memberModel: agent?.memberModel ?? config?.agent.memberModel ?? '',
    adminModel: agent?.adminModel ?? config?.agent.adminModel ?? '',
    timeoutMs: agent?.timeoutMs ?? config?.agent.timeoutMs ?? undefined,
    overrides: {
      baseUrl: Boolean(agent?.baseUrl),
      memberModel: Boolean(agent?.memberModel),
      adminModel: Boolean(agent?.adminModel),
      timeoutMs: Boolean(agent?.timeoutMs),
    },
  };
}

function normalizeDeckAgentSettings(config: AppConfig, value: Record<string, unknown> | undefined): DeckAgentSettings | undefined {
  if (!value) return undefined;
  const agent: DeckAgentSettings = {};
  const baseUrl = optionalString(value.baseUrl)?.trim().replace(/\/$/, '');
  if (baseUrl && baseUrl !== config.agent.baseUrl) agent.baseUrl = baseUrl;
  const memberModel = optionalString(value.memberModel)?.trim();
  if (memberModel && memberModel !== config.agent.memberModel) agent.memberModel = memberModel;
  const adminModel = optionalString(value.adminModel)?.trim();
  if (adminModel && adminModel !== config.agent.adminModel) agent.adminModel = adminModel;
  const timeoutMs = optionalPositiveInt(value.timeoutMs, 'timeoutMs');
  if (timeoutMs && timeoutMs !== config.agent.timeoutMs) agent.timeoutMs = timeoutMs;
  return Object.keys(agent).length ? agent : undefined;
}

async function fetchModelProviderModels(config: AppConfig, baseUrl: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${agentApiKey(config)}`,
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw Object.assign(new Error(`Model provider returned ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`), { statusCode: 502 });
    }
    const payload = await response.json() as { data?: Array<{ id?: unknown }>; models?: unknown[] };
    const candidates = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
    return candidates
      .map((item) => (typeof item === 'string' ? item : typeof item === 'object' && item && 'id' in item ? String((item as { id: unknown }).id) : ''))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw Object.assign(new Error('Model provider models request timed out'), { statusCode: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function formatShare(share: ShareRecord): ShareRecord {
  return { ...share, url: `/client/${share.token}` };
}

function normalizeDraftDeckUrl(id: string, url?: string) {
  if (!url || !url.includes('#/')) return draftDeckUrl(id);
  return url;
}

function normalizePublishedDeckUrl(id: string, url?: string) {
  if (!url) return undefined;
  if (!url.includes('#/')) return `/published/${id}/#/1`;
  return url;
}

function draftDeckUrl(id: string) {
  return `/draft/${id}/#/1`;
}

function deckIdFromHost(config: AppConfig, hostHeader: string | undefined): string | undefined {
  if (!config.decksDomain || !hostHeader) return undefined;
  const host = hostHeader.split(':')[0]?.toLowerCase();
  const suffix = `.${config.decksDomain.toLowerCase()}`;
  if (!host || !host.endsWith(suffix)) return undefined;
  const deckId = host.slice(0, -suffix.length);
  if (!deckId || deckId.includes('.') || !/^[a-z0-9][a-z0-9-]*$/i.test(deckId)) return undefined;
  return deckId;
}

function shareVisitorUser(visitor: ShareVisitorRecord): UserRecord {
  return {
    id: `share:${visitor.id}`,
    email: visitor.email,
    name: visitor.name,
    role: 'employee',
    status: 'active',
    createdAt: visitor.createdAt,
    updatedAt: visitor.createdAt,
  };
}

function withShareVisitorInstruction(body: Record<string, unknown>, visitor: ShareVisitorRecord): Record<string, unknown> {
  const instruction = optionalString(body.instruction) ?? optionalString(body.message);
  if (!instruction) return body;
  return {
    ...body,
    instruction: `Client edit from ${visitor.name} <${visitor.email}>:\n${instruction}`,
  };
}

async function recordInstruction(
  config: AppConfig,
  decks: DeckStore,
  chat: ChatService,
  agentRuns: AgentRunService,
  id: string,
  body: Record<string, unknown>,
  user: UserRecord,
  emit?: (event: string, data: unknown) => void,
) {
  const instruction = optionalString(body.instruction) ?? optionalString(body.message);
  if (!instruction?.trim()) {
    throw Object.assign(new Error('Instruction is required'), { statusCode: 400 });
  }
  const deck = await decks.get(id);
  const now = new Date().toISOString();
  const runConfig = agentRunConfig(config, user, deck);
  const controller = new AbortController();
  const run = await agentRuns.start({
    deckId: id,
    model: runConfig.model,
    roleScope: runConfig.roleScope,
    controller,
  });
  emit?.('run', { run });
  try {
    emit?.('status', { status: 'calling_model', runId: run.id });
    const result = await runDeckEditAgent(config, user, deck, instruction.trim(), {
      signal: controller.signal,
      deckRoot: decks.deckPath(id),
      onEvent: (event, data) => emit?.(event, { ...(typeof data === 'object' && data !== null ? data as Record<string, unknown> : { value: data }), runId: run.id }),
    });
    emit?.('status', { status: 'writing_file', runId: run.id });
    const updatedDeck = await applyAgentEditResult(decks, deck, id, result, emit, run.id);
    const messages = [
      { role: 'user' as const, content: instruction.trim(), createdAt: now },
      {
        role: 'agent' as const,
        content: `${result.summary}\n\nModel: ${result.model}\nRun: ${run.id}`,
        createdAt: new Date().toISOString(),
      },
    ];
    await chat.append(updatedDeck.meta.id, messages);
    await agentRuns.finish(run.id, 'done');
    const updated = await decks.get(id);
    return updated;
  } catch (error) {
    const statusCode = error instanceof Error && 'statusCode' in error ? (error as { statusCode?: number }).statusCode : undefined;
    await agentRuns.finish(run.id, statusCode === 499 ? 'canceled' : 'error', error instanceof Error ? error.message : 'Agent run failed');
    throw error;
  }
}

async function applyAgentEditResult(
  decks: DeckStore,
  deck: Awaited<ReturnType<DeckStore['get']>>,
  id: string,
  result: Awaited<ReturnType<typeof runDeckEditAgent>>,
  emit: ((event: string, data: unknown) => void) | undefined,
  runId: string,
): Promise<Awaited<ReturnType<DeckStore['get']>>> {
  if (result.mode === 'workspace') {
    const changedFiles = result.changedFiles ?? [];
    if (!changedFiles.length) {
      throw Object.assign(new Error('Agent did not change any runtime workspace files'), { statusCode: 502 });
    }
    for (const file of changedFiles) {
      emit?.('file_change', { path: file.replace(/^\//, ''), deckId: id, runId });
    }
    await decks.updateMeta(id, {});
    return decks.get(id);
  }

  if (!result.markdown?.trim()) {
    throw Object.assign(new Error('Agent did not return markdown'), { statusCode: 502 });
  }
  if (result.markdown.trim() === deck.markdown.trim()) {
    throw Object.assign(new Error('Agent returned unchanged markdown'), { statusCode: 502 });
  }
  const updatedDeck = await decks.update(id, { markdown: result.markdown });
  emit?.('file_change', { path: 'slides.md', deckId: id, runId });
  return updatedDeck;
}

function sendSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

class RuntimeEventHub {
  private readonly clients = new Map<string, Set<ServerResponse>>();

  register(deckId: string, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    const clients = this.clients.get(deckId) ?? new Set<ServerResponse>();
    clients.add(res);
    this.clients.set(deckId, clients);
    res.on('close', () => {
      clients.delete(res);
      if (!clients.size) this.clients.delete(deckId);
    });
  }

  emit(deckId: string): void {
    const clients = this.clients.get(deckId);
    if (!clients?.size) return;
    for (const client of clients) {
      sendSse(client, 'deck_changed', { deckId, changedAt: new Date().toISOString() });
    }
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw Object.assign(new Error('Expected JSON object body'), { statusCode: 400 });
}

function asOptionalObject(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw Object.assign(new Error('Expected JSON object value'), { statusCode: 400 });
}

async function validateScaffoldSettings(decks: DeckStore, value: Record<string, unknown> | undefined): Promise<void> {
  if (!value) return;
  const scaffolds = await decks.listScaffolds({ includeInactive: true, userRole: 'admin' });
  const keys = new Set(scaffolds.map((item) => item.key));
  const defaultKey = optionalString(value.defaultKey);
  if (defaultKey && !keys.has(defaultKey)) {
    throw Object.assign(new Error(`Scaffold not found: ${defaultKey}`), { statusCode: 404 });
  }
  const items = asOptionalObject(value.items);
  for (const key of Object.keys(items ?? {})) {
    if (!keys.has(key)) throw Object.assign(new Error(`Scaffold not found: ${key}`), { statusCode: 404 });
  }
}

async function resolveCollaboratorUser(auth: AuthService, body: Record<string, unknown>): Promise<UserRecord> {
  const users = await auth.listUsers();
  const userId = optionalString(body.userId);
  const email = optionalString(body.email)?.trim().toLowerCase();
  const user = userId
    ? users.find((candidate) => candidate.id === userId)
    : users.find((candidate) => candidate.email.toLowerCase() === email);
  if (!user || user.status === 'disabled') {
    throw Object.assign(new Error('Active user not found for collaborator'), { statusCode: 404 });
  }
  return user;
}

async function formatCollaborators(auth: AuthService, records: DeckCollaboratorRecord[]) {
  const users = await auth.listUsers();
  const usersById = new Map(users.map((user) => [user.id, user]));
  return records.map((record) => {
    const user = usersById.get(record.userId);
    return {
      ...record,
      user: user ? {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      } : undefined,
    };
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalPositiveInt(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  throw Object.assign(new Error(`${label} must be a positive integer`), { statusCode: 400 });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  throw Object.assign(new Error(`${label} is required`), { statusCode: 400 });
}

function optionalRole(value: unknown): UserRole | undefined {
  if (value === undefined) return undefined;
  if (value === 'admin' || value === 'employee') return value;
  throw Object.assign(new Error('Unsupported role'), { statusCode: 400 });
}

function optionalUserStatus(value: unknown): UserRecord['status'] | undefined {
  if (value === undefined) return undefined;
  if (value === 'invited' || value === 'active' || value === 'disabled') return value;
  throw Object.assign(new Error('Unsupported user status'), { statusCode: 400 });
}

function optionalExportFormat(value: unknown): ExportFormat | undefined {
  if (value === undefined) return undefined;
  if (value === 'pptx' || value === 'markdown') return value;
  throw Object.assign(new Error('Unsupported export format'), { statusCode: 400 });
}

function assertDownloadable(job: ExportJob): asserts job is ExportJob & { outputPath: string } {
  if (job.status !== 'succeeded' || !job.outputPath) {
    throw Object.assign(new Error('Export is not ready for download'), { statusCode: 409 });
  }
}

function safeStaticPath(root: string, requestPath: string): string {
  const resolved = path.resolve(root, requestPath);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw Object.assign(new Error('Invalid static path'), { statusCode: 400 });
  }
  return resolved;
}

async function sendSlidevStatic(res: Parameters<typeof sendInlineFile>[0], outDir: string, requestPath: string) {
  const filePath = safeStaticPath(outDir, requestPath);
  try {
    await sendInlineFile(res, filePath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      await sendInlineFile(res, path.join(outDir, 'index.html'));
      return;
    }
    throw error;
  }
}

async function sendRuntimeFile(res: Parameters<typeof sendInlineFile>[0], deckDir: string, requestPath: string): Promise<void> {
  const normalized = runtimeRequestPath(requestPath);
  if (!isAllowedRuntimeAsset(normalized)) {
    throw Object.assign(new Error('Runtime asset is not allowed'), { statusCode: 404 });
  }
  await sendInlineFile(res, safeStaticPath(deckDir, normalized));
}

function runtimeRequestPath(requestPath: string): string {
  const decoded = decodeURIComponent(requestPath || 'index.html').replace(/^\/+/, '');
  if (!decoded || decoded.endsWith('/')) return 'index.html';
  if (!path.posix.extname(decoded)) return 'index.html';
  return decoded;
}

function isAllowedRuntimeAsset(requestPath: string): boolean {
  const normalized = path.posix.normalize(requestPath);
  if (normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) return false;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment.startsWith('.'))) return false;
  if (segments.includes('node_modules') || segments.includes('dist')) return false;
  if (['meta.json', 'slides.md', 'package.json', 'package-lock.json'].includes(path.posix.basename(normalized))) return false;
  return true;
}

