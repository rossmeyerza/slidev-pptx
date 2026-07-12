#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '[smoke-auth-org] %s\n' "$*"
}

log "building server"
npm --prefix "$ROOT_DIR" run build:server >/dev/null

log "checking better-auth organization/member sync"
node --input-type=module - "$ROOT_DIR" <<'NODE'
const root = process.argv[2];
const { AuthService } = await import(`file://${root}/apps/server/dist/auth/auth.js`);
const { DeckStore } = await import(`file://${root}/apps/server/dist/decks/decks.js`);

const queries = [];
const pool = {
  async query(sql, params = []) {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes('insert into org(name, slug)')) return { rowCount: 1, rows: [{ id: '00000000-0000-4000-8000-000000000123' }] };
    if (String(sql).includes('from "user" u')) return { rowCount: 0, rows: [] };
    if (String(sql).includes('insert into "user"')) return { rowCount: 1, rows: [] };
    if (String(sql).includes('insert into app_user_profile')) return { rowCount: 1, rows: [] };
    if (String(sql).includes('insert into "organization"')) return { rowCount: 1, rows: [] };
    if (String(sql).includes('insert into "member"')) return { rowCount: 1, rows: [] };
    if (String(sql).includes('insert into app_auth_token')) return { rowCount: 1, rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  },
};

const config = {
  dataDir: '/tmp/slidev-auth-org-smoke',
  publicBaseUrl: 'http://127.0.0.1:4321',
  auth: {
    bootstrapAdminEmail: 'owner@example.com',
    bootstrapAdminName: 'Owner',
    betterAuthSecret: 'org-smoke-secret',
    sessionDays: 14,
    tokenMinutes: 30,
    organizationId: 'acme',
    organizationName: 'Acme Decks',
    organizationSlug: 'acme-decks',
  },
};

const auth = new AuthService(config, pool);
await auth.bootstrap();
await auth.inviteUser({
  email: 'employee@example.com',
  name: 'Employee',
  role: 'employee',
  createdByUserId: 'owner',
});

const orgQueries = queries.filter((query) => query.sql.includes('insert into "organization"'));
const memberQueries = queries.filter((query) => query.sql.includes('insert into "member"'));
if (orgQueries.length < 2) throw new Error(`expected org upsert for bootstrap and invite, got ${orgQueries.length}`);
if (memberQueries.length < 2) throw new Error(`expected member upsert for bootstrap and invite, got ${memberQueries.length}`);

const adminMember = memberQueries.find((query) => query.params[3] === 'admin');
const employeeMember = memberQueries.find((query) => query.params[3] === 'member');
if (!adminMember) throw new Error('admin user was not synced as org admin');
if (!employeeMember) throw new Error('employee user was not synced as org member');
for (const query of memberQueries) {
  if (query.params[1] !== 'acme') throw new Error(`member was written to wrong org: ${JSON.stringify(query.params)}`);
  if (!String(query.params[0]).startsWith('acme:')) throw new Error(`member id should be deterministic: ${JSON.stringify(query.params)}`);
}

const decks = new DeckStore({
  ...config,
  repoRoot: root,
  decksDir: '/tmp/slidev-auth-org-smoke/decks',
  scaffoldKey: 'commercial-html',
}, pool);
const appOrgId = await decks.configuredOrgId();
if (appOrgId !== '00000000-0000-4000-8000-000000000123') throw new Error(`configured app org id was not returned: ${appOrgId}`);
const appOrgQuery = queries.find((query) => query.sql.includes('insert into org(name, slug)'));
if (!appOrgQuery) throw new Error('app org was not upserted');
if (appOrgQuery.params[0] !== 'Acme Decks' || appOrgQuery.params[1] !== 'acme-decks') {
  throw new Error(`app org should use configured name/slug: ${JSON.stringify(appOrgQuery.params)}`);
}
NODE

log "auth org smoke passed"
