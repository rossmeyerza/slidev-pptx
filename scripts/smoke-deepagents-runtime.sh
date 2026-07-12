#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${SMOKE_DEEPAGENTS_PORT:-4349}"
WORK_DIR="${SMOKE_DEEPAGENTS_WORK_DIR:-/tmp/slidev-agent-platform-deepagents-smoke}"
COOKIE_JAR="$WORK_DIR/cookies.txt"
SERVER_LOG="$WORK_DIR/server.log"
SERVER_PID=""

log() {
  printf '[smoke-deepagents] %s\n' "$*"
}

fail() {
  printf '[smoke-deepagents] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "${RUN_DEEPAGENTS_SMOKE:-}" != "true" ]]; then
  log "skipping: set RUN_DEEPAGENTS_SMOKE=true to exercise deepagents"
  exit 0
fi

wait_for_server() {
  for _ in {1..90}; do
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

log "building server and web app"
npm --prefix "$ROOT_DIR" run build:server >/dev/null
npm --prefix "$ROOT_DIR" run build:web >/dev/null

log "starting server with deepagents on port $PORT"
(
  cd "$ROOT_DIR"
  SKIP_ENV_LOCAL=true \
  DECKHAND_DATA_DIR="$WORK_DIR/data" \
  HOST=127.0.0.1 \
  PORT="$PORT" \
  PUBLIC_BASE_URL="http://127.0.0.1:$PORT" \
  AUTH_DEV_LINK=true \
  AUTH_BOOTSTRAP_ADMIN_EMAIL="deep-admin@example.com" \
  AUTH_BOOTSTRAP_ADMIN_NAME="Deep Agent Admin" \
  node apps/server/dist/index.js
) >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

wait_for_server || {
  sed -n '1,160p' "$SERVER_LOG" >&2 || true
  fail "server did not become ready"
}

login_payload="$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/auth/login" -H 'content-type: application/json' --data '{"email":"deep-admin@example.com"}')"
login_url="$(printf '%s' "$login_payload" | json_string loginUrl)"
curl -fsS -c "$COOKIE_JAR" "$login_url" >/dev/null
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/agent/runtime" | grep -q '"runtime":"deepagents"' || fail "deepagents runtime was not active"

deck_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks" -H 'content-type: application/json' --data '{"title":"Deep Agent Smoke"}')"
deck_id="$(printf '%s' "$deck_payload" | json_string id)"
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/instructions" -H 'content-type: application/json' --data '{"instruction":"Add one short agenda slide."}' | grep -q 'markdown' || fail "deepagents instruction did not return deck payload"

log "deepagents runtime smoke passed"
