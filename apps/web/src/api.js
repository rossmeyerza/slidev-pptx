// @ts-check
import { betterAuthSignOut, getBetterAuthSession, requestBetterAuthMagicLink } from './authClient.js';

/**
 * @typedef {{ id:string, email:string, name:string, role:'admin'|'employee', status:string }} User
 * @typedef {{ baseUrl?:string, memberModel?:string, adminModel?:string, timeoutMs?:number, overrides?:Record<string, boolean> }} DeckAgentSettings
 * @typedef {{ id:string, title:string, owner:string, status:string, scaffoldKey?:string, activeEditorUserId?:string, updatedAt?:string, previewUrl?:string, publishedUrl?:string, shares?:ShareLink[], messages?:ChatMessage[], snapshots?:{id:string,createdAt:string}[], agent?:DeckAgentSettings, pptx?:{ id:string, format?:'pptx'|'pdf'|'markdown', status:string, downloadUrl?:string, error?:string, updatedAt?:string, verification?:{ slideCount:number, imageCount:number } } }} Deck
 * @typedef {{ id:string, deckId:string, userId:string, role:'editor'|'viewer', createdAt:string, user?:User }} Collaborator
 * @typedef {{ key:string, name:string, description:string, thumbnailUrl?:string, isDefault:boolean, isActive?:boolean, minRole?:'admin'|'employee' }} Scaffold
 * @typedef {{ id:string, url:string, name:string, email:string, permission?:'view'|'edit', hasPassword?:boolean, expiresAt?:string, viewCount?:number, lastViewedAt?:string }} ShareLink
 * @typedef {Deck & { share?:ShareLink, visitor?:{ id:string, name:string, email:string }, passwordRequired?:boolean, visitorRequired?:boolean }} SharedDeck
 * @typedef {{ role:'user'|'agent', content:string, createdAt?:string }} ChatMessage
 */

export const queryKeys = {
  authProvider: ['auth-provider'],
  session: ['session'],
  decks: ['decks'],
  deck: (id) => ['deck', id],
  collaborators: (id) => ['deck', id, 'collaborators'],
  scaffolds: ['scaffolds'],
  livePreview: (id) => ['deck', id, 'live-preview'],
  settings: ['admin', 'settings'],
  agentModels: (baseUrl) => ['admin', 'agent-models', baseUrl],
  share: (token) => ['share', token],
};

let authProviderPromise = null;

export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(payload.error ?? `${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function normalizeDeck(raw) {
  return {
    ...raw,
    id: raw.id ?? raw.deckId ?? crypto.randomUUID(),
    title: raw.title ?? 'Untitled deck',
    owner: raw.owner ?? raw.createdBy ?? 'Internal',
    status: raw.status ?? 'draft',
    scaffoldKey: raw.scaffoldKey ?? '',
    activeEditorUserId: raw.activeEditorUserId ?? '',
    updatedAt: raw.updatedAt ?? null,
    previewUrl: raw.previewUrl ?? raw.draftUrl ?? '',
    publishedUrl: raw.publishedUrl ?? '',
    shares: raw.shares ?? [],
    messages: raw.messages ?? [],
    agent: raw.agent ?? null,
    pptx: raw.pptx ?? null,
  };
}

export async function getAuthProvider() {
  if (!authProviderPromise) authProviderPromise = api('/api/auth/provider');
  return authProviderPromise;
}

export async function getSession() {
  const provider = await getAuthProvider().catch(() => null);
  const betterAuthEnabled = Boolean(provider?.betterAuth?.enabled);
  if (betterAuthEnabled) {
    await getBetterAuthSession().catch(() => null);
  }
  return api('/api/auth/me');
}

export async function requestLogin(email) {
  const provider = await getAuthProvider().catch(() => null);
  if (provider?.betterAuth?.enabled && provider?.smtp?.enabled) {
    return requestBetterAuthMagicLink(email);
  }
  return api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email }) });
}

export function bootstrapAdmin({ email, name }) {
  return api('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ email, name }) });
}

export async function logout() {
  await betterAuthSignOut();
  return api('/api/auth/logout', { method: 'POST' });
}

export async function listDecks() {
  const payload = await api('/api/decks');
  return (payload.decks ?? []).map(normalizeDeck);
}

export async function getDeck(id) {
  const payload = await api(`/api/decks/${encodeURIComponent(id)}`);
  return normalizeDeck(payload.deck ?? payload.data ?? payload);
}

export async function createDeck(input) {
  const payload = await api('/api/decks', { method: 'POST', body: JSON.stringify(input) });
  return normalizeDeck(payload.deck ?? payload.data ?? payload);
}

export async function listScaffolds() {
  const payload = await api('/api/scaffolds');
  return payload.scaffolds ?? [];
}

export async function sendInstruction(deckId, instruction, targetSlide) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/instructions`, {
    method: 'POST',
    body: JSON.stringify({ instruction, ...(targetSlide ? { targetSlide } : {}) }),
  });
  return normalizeDeck(payload.deck ?? payload.data ?? payload);
}

export async function sendInstructionStream(deckId, instruction, onEvent = () => {}, targetSlide) {
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/messages`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instruction, ...(targetSlide ? { targetSlide } : {}) }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text ? JSON.parse(text).error ?? text : `${response.status} ${response.statusText}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let doneDeck = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const event = parseSseEvent(part);
      if (!event) continue;
      onEvent(event);
      if (event.event === 'error') throw new Error(event.data?.error ?? 'Instruction failed.');
      if (event.event === 'done') doneDeck = normalizeDeck(event.data?.deck ?? event.data);
    }
  }
  if (!doneDeck) throw new Error('Instruction stream ended without a done event.');
  return doneDeck;
}

export function cancelAgentRun(deckId, runId) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function acquireDeckLock(deckId) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/lock`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return normalizeDeck(payload.deck ?? payload.data ?? payload);
}

export async function releaseDeckLock(deckId) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/lock`, {
    method: 'DELETE',
  });
  return normalizeDeck(payload.deck ?? payload.data ?? payload);
}

export async function startLivePreview(deckId) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/live`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return payload.preview ?? payload;
}

export function createAdminComponent(deckId, input) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/admin-tools/components`, { method: 'POST', body: JSON.stringify(input) });
}

export function createAdminLayout(deckId, input) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/admin-tools/layouts`, { method: 'POST', body: JSON.stringify(input) });
}

export function addAdminDependency(deckId, input) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/admin-tools/dependencies`, { method: 'POST', body: JSON.stringify(input) });
}

export function restartDeckPreview(deckId) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/admin-tools/restart-preview`, { method: 'POST', body: JSON.stringify({}) });
}

export async function getDeckAgentSettings(deckId) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/agent-settings`);
  return payload.agent ?? {};
}

export async function updateDeckAgentSettings(deckId, agent) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/agent-settings`, {
    method: 'PATCH',
    body: JSON.stringify({ agent }),
  });
  return payload.agent ?? {};
}

function parseSseEvent(raw) {
  const lines = raw.split('\n');
  let event = 'message';
  const data = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  return { event, data: JSON.parse(data.join('\n')) };
}

export async function publishDeck(deckId) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/publish`, { method: 'POST', body: JSON.stringify({}) });
  return normalizeDeck(payload.deck ?? payload.data ?? payload);
}

export async function createShare(deckId, input) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/shares`, { method: 'POST', body: JSON.stringify(input) });
}

export async function updateDeck(deckId, input) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}`, { method: 'PUT', body: JSON.stringify(input) });
  return normalizeDeck(payload.deck ?? payload.data ?? payload);
}

export function deleteDeck(deckId) {
  return api(`/api/decks/${encodeURIComponent(deckId)}`, { method: 'DELETE' });
}

export async function duplicateDeck(deckId) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/duplicate`, { method: 'POST', body: JSON.stringify({}) });
  return normalizeDeck(payload.deck ?? payload.data ?? payload);
}

export function saveDeckAsTemplate(deckId, input) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/template`, { method: 'POST', body: JSON.stringify(input) });
}

export async function listDeckFiles(deckId) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/files`);
  return payload.files ?? [];
}

export function getDeckFile(deckId, path) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/files/content?path=${encodeURIComponent(path)}`);
}

export function saveDeckFile(deckId, path, content) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/files/content`, { method: 'PUT', body: JSON.stringify({ path, content }) });
}

export async function listShareVisitors(deckId, shareId) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/shares/${encodeURIComponent(shareId)}/visitors`);
  return payload.visitors ?? [];
}

export async function revokeShare(deckId, shareId) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' });
}

export async function listCollaborators(deckId) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/collaborators`);
  return payload.collaborators ?? [];
}

export function saveCollaborator(deckId, input) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/collaborators`, { method: 'POST', body: JSON.stringify(input) });
}

export function removeCollaborator(deckId, userId) {
  return api(`/api/decks/${encodeURIComponent(deckId)}/collaborators/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export async function exportDeck(deckId, format = 'pptx') {
  return api(`/api/decks/${encodeURIComponent(deckId)}/export`, { method: 'POST', body: JSON.stringify({ format }) });
}

export async function revertDeck(deckId, snapshotId) {
  const payload = await api(`/api/decks/${encodeURIComponent(deckId)}/revert`, { method: 'POST', body: JSON.stringify(snapshotId ? { snapshotId } : {}) });
  return normalizeDeck(payload.deck ?? payload.data ?? payload);
}

export async function uploadDeckAsset(deckId, file) {
  const contentBase64 = await fileToBase64(file);
  return api(`/api/decks/${encodeURIComponent(deckId)}/assets`, {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, contentBase64 }),
  });
}

export async function getExport(jobId) {
  return api(`/api/exports/${encodeURIComponent(jobId)}`);
}

export function inviteUser(input) {
  return api('/api/users/invite', { method: 'POST', body: JSON.stringify(input) });
}

export function updateUser(userId, input) {
  return api(`/api/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function listUsers() {
  const payload = await api('/api/users');
  return payload.users ?? [];
}

export function getAdminSettings() {
  return api('/api/admin/settings');
}

export function updateAdminSettings(input) {
  return api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(input) });
}

export async function listAgentModels(baseUrl) {
  const query = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : '';
  const payload = await api(`/api/admin/agent-models${query}`);
  return payload.models ?? [];
}

export async function getSharedDeck(token) {
  const payload = await api(`/api/share/${encodeURIComponent(token)}`);
  if (payload.passwordRequired) return payload;
  return normalizeSharedDeck(payload);
}

export function submitSharePassword(token, password) {
  return api(`/api/share/${encodeURIComponent(token)}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function identifyShareVisitor(token, input) {
  const payload = await api(`/api/share/${encodeURIComponent(token)}/visitor`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return payload.visitor;
}

export async function sendShareInstruction(token, instruction) {
  const payload = await api(`/api/share/${encodeURIComponent(token)}/instructions`, {
    method: 'POST',
    body: JSON.stringify({ instruction }),
  });
  return normalizeSharedDeck(payload);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read file.')));
    reader.addEventListener('load', () => resolve(String(reader.result ?? '').split(',').pop() ?? ''));
    reader.readAsDataURL(file);
  });
}

function normalizeSharedDeck(raw) {
  return {
    ...normalizeDeck(raw),
    share: raw.share ?? null,
    visitor: raw.visitor ?? null,
    passwordRequired: Boolean(raw.passwordRequired),
    visitorRequired: Boolean(raw.visitorRequired),
  };
}
