#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${SMOKE_NOTIFICATIONS_WORK_DIR:-/tmp/slidev-agent-platform-notifications-smoke}"
PORT="${SMOKE_NOTIFICATIONS_PORT:-4351}"
COOKIE_JAR="$WORK_DIR/cookies.txt"
SERVER_LOG="$WORK_DIR/server.log"
SERVER_PID=""

log() {
  printf '[smoke-notifications] %s\n' "$*"
}

fail() {
  printf '[smoke-notifications] ERROR: %s\n' "$*" >&2
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

json_string() {
  node -e "const fs=require('fs'); const path=process.argv[1].split('.'); let value=JSON.parse(fs.readFileSync(0,'utf8')); for (const key of path) value=value?.[key]; if (typeof value === 'string') process.stdout.write(value); else process.exit(1)" "$1"
}

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

log "building server"
npm --prefix "$ROOT_DIR" run build:server >/dev/null

log "starting isolated server without SMTP on port $PORT"
(
  cd "$ROOT_DIR"
  SKIP_ENV_LOCAL=true \
  DECKHAND_DATA_DIR="$WORK_DIR/data" \
  HOST=127.0.0.1 \
  PORT="$PORT" \
  PUBLIC_BASE_URL="http://127.0.0.1:$PORT" \
  AUTH_DEV_LINK=true \
  AUTH_BOOTSTRAP_ADMIN_EMAIL="notifications-owner@example.com" \
  AUTH_BOOTSTRAP_ADMIN_NAME="Notifications Owner" \
  node apps/server/dist/index.js
) >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

wait_for_server || {
  sed -n '1,160p' "$SERVER_LOG" >&2 || true
  fail "server did not become ready"
}

log "creating owner session and deck"
login_payload="$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/auth/login" -H 'content-type: application/json' --data '{"email":"notifications-owner@example.com"}')"
login_url="$(printf '%s' "$login_payload" | json_string loginUrl)"
[[ -n "$login_url" ]] || fail "loginUrl was not returned with SMTP disabled"
curl -fsS -c "$COOKIE_JAR" "$login_url" >/dev/null

deck_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks" -H 'content-type: application/json' --data '{"title":"Notifications Smoke Deck"}')"
deck_id="$(printf '%s' "$deck_payload" | json_string id)"
[[ -n "$deck_id" ]] || fail "deck id was not returned"

log "creating edit share and identifying the same visitor twice"
share_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/shares" -H 'content-type: application/json' --data '{"name":"Notification Editor","email":"editor@example.com","permission":"edit"}')"
share_token="$(printf '%s' "$share_payload" | json_string share.token)"
[[ -n "$share_token" ]] || fail "share token was not returned"

first_status="$(curl -sS -o "$WORK_DIR/visitor-first.json" -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/share/$share_token/visitor" -H 'content-type: application/json' --data '{"name":"Actual Editor","email":"same-editor@example.com"}')"
[[ "$first_status" == "200" ]] || fail "first visitor identify returned HTTP $first_status"
grep -q '"email":"same-editor@example.com"' "$WORK_DIR/visitor-first.json" || fail "first visitor response was unexpected"

second_status="$(curl -sS -o "$WORK_DIR/visitor-second.json" -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/share/$share_token/visitor" -H 'content-type: application/json' --data '{"name":"Actual Editor","email":"same-editor@example.com"}')"
[[ "$second_status" == "200" ]] || fail "second visitor identify returned HTTP $second_status"
grep -q '"email":"same-editor@example.com"' "$WORK_DIR/visitor-second.json" || fail "second visitor response was unexpected"

log "notifications smoke passed"
