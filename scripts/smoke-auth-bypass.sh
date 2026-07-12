#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${SMOKE_AUTH_BYPASS_WORK_DIR:-/tmp/slidev-agent-platform-auth-bypass-smoke}"
PORT="${SMOKE_AUTH_BYPASS_PORT:-4339}"
SERVER_LOG="$WORK_DIR/server.log"
SERVER_PID=""

log() {
  printf '[smoke-auth-bypass] %s\n' "$*"
}

fail() {
  printf '[smoke-auth-bypass] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_server() {
  for _ in {1..60}; do
    if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

log "building server and web app"
npm --prefix "$ROOT_DIR" run build:server >/dev/null
npm --prefix "$ROOT_DIR" run build:web >/dev/null

log "starting auth-bypass server on port $PORT"
(
  cd "$ROOT_DIR"
  SKIP_ENV_LOCAL=true \
  AUTH_BYPASS=true \
  DECKHAND_DATA_DIR="$WORK_DIR/data" \
  HOST=127.0.0.1 \
  PORT="$PORT" \
  PUBLIC_BASE_URL="http://127.0.0.1:$PORT" \
  node apps/server/dist/index.js
) >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

wait_for_server || {
  sed -n '1,160p' "$SERVER_LOG" >&2 || true
  fail "server did not become ready"
}

curl -fsS "http://127.0.0.1:$PORT/api/auth/provider" | grep -q '"bypass":true' || fail "auth provider should report bypass mode"
curl -fsS "http://127.0.0.1:$PORT/api/auth/me" | grep -q '"id":"dev-auth-bypass-admin"' || fail "auth bypass should return synthetic admin"
curl -fsS "http://127.0.0.1:$PORT/api/users" | grep -q '\[' || fail "admin route should be accessible without login in bypass mode"
deck_payload="$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/decks" -H 'content-type: application/json' --data '{"title":"Bypass Deck","scaffold":"custom-html"}')"
printf '%s' "$deck_payload" | grep -q '"ownerUserId":"dev-auth-bypass-admin"' || fail "created deck should use bypass admin as owner"

log "auth bypass smoke passed"
