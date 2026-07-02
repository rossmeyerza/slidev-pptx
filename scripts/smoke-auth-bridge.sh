#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '[smoke-auth-bridge] %s\n' "$*"
}

log "building server"
npm --prefix "$ROOT_DIR" run build:server >/dev/null

log "checking compatibility and better-auth session cookies"
node --input-type=module - "$ROOT_DIR" <<'NODE'
import crypto from 'node:crypto';

const root = process.argv[2];
const { AuthService } = await import(`file://${root}/apps/server/dist/auth/auth.js`);

const secret = 'bridge-smoke-secret';
const rawToken = 'raw-session-token';
const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
const row = {
  session_id: 'session-1',
  token_hash: rawToken,
  user_id: 'user-1',
  session_created_at: new Date('2026-01-01T00:00:00Z'),
  expires_at: new Date(Date.now() + 3600_000),
  id: 'user-1',
  email: 'admin@example.com',
  name: 'Admin',
  user_created_at: new Date('2026-01-01T00:00:00Z'),
  user_updated_at: new Date('2026-01-01T00:00:00Z'),
  banned: false,
  app_role: 'admin',
  status: 'active',
  last_login_at: null,
};

const queries = [];
const pool = {
  async query(sql, params = []) {
    queries.push({ sql, params });
    if (String(sql).includes('from "session"')) {
      const candidates = params[0] ?? [];
      if (Array.isArray(candidates) && (candidates.includes(rawToken) || candidates.includes(hashedToken))) {
        return { rowCount: 1, rows: [row] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (String(sql).includes('delete from "session"')) {
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  },
};

const config = {
  dataDir: '/tmp/slidev-auth-bridge-smoke',
  publicBaseUrl: 'http://127.0.0.1:4321',
  auth: {
    betterAuthSecret: secret,
    sessionDays: 14,
    tokenMinutes: 30,
  },
};

const auth = new AuthService(config, pool);
const cookies = await auth.sessionCookie(rawToken, {
  id: 'session-1',
  tokenHash: hashedToken,
  userId: 'user-1',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
});
const betterCookie = cookies.find((cookie) => cookie.startsWith('better-auth.session_token='));
if (!betterCookie) throw new Error('expected better-auth session cookie');

const betterCookieValue = decodeURIComponent(betterCookie.split(';')[0].split('=').slice(1).join('='));
const betterContext = await auth.currentUser({
  headers: { cookie: `better-auth.session_token=${encodeURIComponent(betterCookieValue)}` },
  params: {},
  urlObject: new URL('http://localhost/'),
});
if (betterContext?.user.role !== 'admin') throw new Error('better-auth cookie did not resolve admin user');

const legacyContext = await auth.currentUser({
  headers: { cookie: `slidev_session=${rawToken}` },
  params: {},
  urlObject: new URL('http://localhost/'),
});
if (legacyContext?.user.role !== 'admin') throw new Error('legacy cookie did not resolve admin user');

const tampered = await auth.currentUser({
  headers: { cookie: `better-auth.session_token=${encodeURIComponent(`${rawToken}.bad`)}` },
  params: {},
  urlObject: new URL('http://localhost/'),
});
if (tampered) throw new Error('tampered better-auth cookie should not resolve');

await auth.logout({
  headers: { cookie: `slidev_session=${rawToken}; better-auth.session_token=${encodeURIComponent(betterCookieValue)}` },
  params: {},
  urlObject: new URL('http://localhost/'),
});
const deleteQuery = queries.find((query) => String(query.sql).includes('delete from "session"'));
if (!deleteQuery) throw new Error('logout did not delete sessions');
const deletedTokens = deleteQuery.params[0] ?? [];
if (!deletedTokens.includes(rawToken) || !deletedTokens.includes(hashedToken)) {
  throw new Error(`logout should delete raw and hashed session tokens, got ${JSON.stringify(deletedTokens)}`);
}
NODE

log "auth bridge smoke passed"
