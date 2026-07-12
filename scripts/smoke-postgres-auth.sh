#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${SMOKE_AUTH_PORT:-4339}"
WORK_DIR="${SMOKE_AUTH_WORK_DIR:-/tmp/slidev-agent-platform-auth-smoke}"
COOKIE_JAR="$WORK_DIR/cookies.txt"
SERVER_LOG="$WORK_DIR/server.log"
SERVER_PID=""

log() {
  printf '[smoke-postgres-auth] %s\n' "$*"
}

fail() {
  printf '[smoke-postgres-auth] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "${DATABASE_URL:-}" ]]; then
  log "skipping: DATABASE_URL is not set"
  exit 0
fi

wait_for_server() {
  for _ in {1..60}; do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

json_string() {
  node -e "const fs=require('fs'); const key=process.argv[1]; const input=fs.readFileSync(0,'utf8'); const value=JSON.parse(input)[key]; if (typeof value === 'string') process.stdout.write(value); else process.exit(1)" "$1"
}

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

log "building server"
npm --prefix "$ROOT_DIR" run build:server >/dev/null

log "applying migrations"
(
  cd "$ROOT_DIR"
  npm run db:migrate
) >/dev/null

log "starting server with Postgres auth on port $PORT"
(
  cd "$ROOT_DIR"
  SKIP_ENV_LOCAL=true \
  DECKHAND_DATA_DIR="$WORK_DIR/data" \
  HOST=127.0.0.1 \
  PORT="$PORT" \
  PUBLIC_BASE_URL="http://127.0.0.1:$PORT" \
  AUTH_DEV_LINK=true \
  AUTH_BOOTSTRAP_ADMIN_EMAIL="pg-admin@example.com" \
  AUTH_BOOTSTRAP_ADMIN_NAME="Postgres Admin" \
  node apps/server/dist/index.js
) >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

wait_for_server || {
  sed -n '1,160p' "$SERVER_LOG" >&2 || true
  fail "server did not become ready"
}

log "checking better-auth availability and compatibility login"
curl -fsS "http://127.0.0.1:$PORT/api/auth/provider" | grep -q '"enabled":true' || fail "better-auth should be enabled with DATABASE_URL"
login_payload="$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/auth/login" -H 'content-type: application/json' --data '{"email":"pg-admin@example.com"}')"
login_url="$(printf '%s' "$login_payload" | json_string loginUrl)"
[[ -n "$login_url" ]] || fail "loginUrl was not returned with SMTP disabled"
curl -fsS -c "$COOKIE_JAR" "$login_url" >/dev/null
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/auth/me" | grep -q '"role":"admin"' || fail "admin session was not established from Postgres"
grep -q 'better-auth.session_token' "$COOKIE_JAR" || fail "compatibility login should set better-auth session cookie"
node - <<'NODE'
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
(async () => {
  const result = await pool.query(`
    select m."role"
    from "member" m
    join "organization" o on o.id = m."organizationId"
    join "user" u on u.id = m."userId"
    where u.email = 'pg-admin@example.com' and o.slug = 'default'
    limit 1
  `);
  if (!result.rowCount || result.rows[0].role !== 'admin') {
    throw new Error('bootstrap admin was not synced into better-auth organization membership');
  }
})().finally(() => pool.end());
NODE
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/auth/logout" >/dev/null
curl -fsS "http://127.0.0.1:$PORT/api/auth/me" | grep -q '"user":null' || fail "logout should clear Postgres session"

log "Postgres auth smoke passed"
