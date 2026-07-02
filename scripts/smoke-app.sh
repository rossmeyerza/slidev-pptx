#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${SMOKE_APP_WORK_DIR:-/tmp/slidev-agent-platform-app-smoke}"
PORT="${SMOKE_APP_PORT:-4329}"
AGENT_PORT="${SMOKE_AGENT_PORT:-4330}"
COOKIE_JAR="$WORK_DIR/cookies.txt"
EMPLOYEE_COOKIE_JAR="$WORK_DIR/employee-cookies.txt"
SHARE_COOKIE_JAR="$WORK_DIR/share-cookies.txt"
PASSWORD_SHARE_COOKIE_JAR="$WORK_DIR/password-share-cookies.txt"
SERVER_LOG="$WORK_DIR/server.log"
AGENT_LOG="$WORK_DIR/agent.log"
SERVER_PID=""
AGENT_PID=""

log() {
  printf '[smoke-app] %s\n' "$*"
}

fail() {
  printf '[smoke-app] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$AGENT_PID" ]] && kill -0 "$AGENT_PID" >/dev/null 2>&1; then
    kill "$AGENT_PID" >/dev/null 2>&1 || true
    wait "$AGENT_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

start_fake_agent() {
  node - "$AGENT_PORT" >"$AGENT_LOG" 2>&1 <<'NODE' &
const http = require('http');
const port = Number(process.argv[2]);
http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    const authorization = req.headers.authorization || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Missing or invalid Authorization header. Expected: Bearer <token>', type: 'auth_error' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'smoke-model' }, { id: 'smoke-admin-model' }, { id: 'smoke-member-model' }] }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, '127.0.0.1');
NODE
  AGENT_PID="$!"
}

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

json_path_string() {
  node -e "const fs=require('fs'); const path=process.argv[1].split('.'); let value=JSON.parse(fs.readFileSync(0,'utf8')); for (const key of path) value=value?.[key]; if (typeof value === 'string') process.stdout.write(value); else process.exit(1)" "$1"
}

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
start_fake_agent

log "building converter, server and web app"
npm --prefix "$ROOT_DIR" run build >/dev/null
npm --prefix "$ROOT_DIR" run build:server >/dev/null
npm --prefix "$ROOT_DIR" run build:web >/dev/null

log "checking migration command without DATABASE_URL"
(
  cd "$ROOT_DIR"
  SKIP_ENV_LOCAL=true DATABASE_URL= npm run db:migrate
) >/dev/null

log "starting isolated server on port $PORT"
(
  cd "$ROOT_DIR"
  SKIP_ENV_LOCAL=true \
  SLIDEV_AGENT_DATA_DIR="$WORK_DIR/data" \
  HOST=127.0.0.1 \
  PORT="$PORT" \
	  PUBLIC_BASE_URL="http://127.0.0.1:$PORT" \
	  DECKS_DOMAIN="decks.smoke.test" \
	  AGENT_BASE_URL="http://127.0.0.1:$AGENT_PORT/v1" \
  AGENT_MODEL="smoke-model" \
  AUTH_BOOTSTRAP_ADMIN_EMAIL="admin@example.com" \
  AUTH_BOOTSTRAP_ADMIN_NAME="Smoke Admin" \
  node apps/server/dist/index.js
) >"$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

wait_for_server || {
  sed -n '1,160p' "$SERVER_LOG" >&2 || true
  fail "server did not become ready"
}

log "checking signed-out app shell"
curl -fsS "http://127.0.0.1:$PORT/" | grep -q '<div id="root"></div>' || fail "root app shell missing"
curl -sS -i "http://127.0.0.1:$PORT/api/decks" | grep -q '401 Unauthorized' || fail "deck API should require auth"
auth_provider_payload="$(curl -fsS "http://127.0.0.1:$PORT/api/auth/provider")"
printf '%s' "$auth_provider_payload" | grep -q '"enabled":false' || fail "better-auth should be disabled without DATABASE_URL"
printf '%s' "$auth_provider_payload" | grep -q '"magic-link"' || fail "better-auth magic-link plugin should be reported"
printf '%s' "$auth_provider_payload" | grep -q '"smtp":{"enabled":false}' || fail "auth provider should report SMTP availability"
curl -sS -i "http://127.0.0.1:$PORT/api/better-auth/session" | grep -q '503 Service Unavailable' || fail "better-auth handler should require DATABASE_URL"

log "requesting dev login link"
login_payload="$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/auth/login" -H 'content-type: application/json' --data '{"email":"admin@example.com"}')"
login_url="$(printf '%s' "$login_payload" | json_string loginUrl)"
[[ -n "$login_url" ]] || fail "loginUrl was not returned with SMTP disabled"

log "consuming login link"
curl -fsS -c "$COOKIE_JAR" "$login_url" >/dev/null
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/auth/me" | grep -q '"role":"admin"' || fail "admin session was not established"
agent_runtime_payload="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/agent/runtime")"
printf '%s' "$agent_runtime_payload" | grep -q '"runtime":"deepagents"' || fail "agent runtime should be deepagents"
printf '%s' "$agent_runtime_payload" | grep -q '"enabled":false' || fail "LangGraph checkpointing should be disabled without DATABASE_URL"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/admin/settings" | grep -q '"memberModel"' || fail "admin settings should expose agent models"
curl -fsS -b "$COOKIE_JAR" -X PATCH "http://127.0.0.1:$PORT/api/admin/settings" -H 'content-type: application/json' --data "{\"agent\":{\"baseUrl\":\"http://127.0.0.1:$AGENT_PORT/v1\",\"memberModel\":\"smoke-member-model\",\"adminModel\":\"smoke-admin-model\",\"timeoutMs\":90000}}" | grep -q '"adminModel":"smoke-admin-model"' || fail "admin settings should update agent models"
agent_runtime_payload="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/agent/runtime")"
printf '%s' "$agent_runtime_payload" | grep -q '"adminModel":"smoke-admin-model"' || fail "agent runtime should reflect updated admin model"
printf '%s' "$agent_runtime_payload" | grep -q '"memberModel":"smoke-member-model"' || fail "agent runtime should reflect updated member model"
agent_models_payload="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/admin/agent-models?baseUrl=http%3A%2F%2F127.0.0.1%3A$AGENT_PORT%2Fv1")"
printf '%s' "$agent_models_payload" | grep -q '"smoke-admin-model"' || fail "admin agent models should load from provider"
printf '%s' "$agent_models_payload" | grep -q '"smoke-member-model"' || fail "admin agent models should include member model"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/live-previews" | grep -q '"previews":\[\]' || fail "admin should see live preview supervisor status"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/scaffolds" | grep -q '"key":"commercial-profile"' || fail "commercial scaffold was not listed"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/scaffolds" | grep -q '"key":"basic"' || fail "basic scaffold was not listed"
curl -fsS -b "$COOKIE_JAR" -X PATCH "http://127.0.0.1:$PORT/api/admin/settings" -H 'content-type: application/json' --data '{"scaffolds":{"defaultKey":"commercial-profile","items":{"basic":{"name":"Admin Basic","description":"Admin-only smoke scaffold","isActive":true,"minRole":"admin"},"commercial-profile":{"name":"Commercial Profile","description":"Default commercial scaffold","isActive":true,"minRole":"employee"}}}}' | grep -q '"defaultKey":"commercial-profile"' || fail "admin settings should update scaffold curation"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/scaffolds" | grep -q '"name":"Admin Basic"' || fail "admin scaffold list should include curated template name"

log "importing PPTX"
node - "$WORK_DIR/import-source.pptx" <<'NODE'
const PptxGenJS = require('pptxgenjs');
const out = process.argv[2];
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
const slide = pptx.addSlide();
slide.addText('Imported Smoke Deck', { x: 0.8, y: 0.8, w: 8, h: 0.6, fontSize: 30, bold: true });
slide.addText('PPTX import smoke content', { x: 0.8, y: 1.8, w: 8, h: 0.5, fontSize: 18 });
pptx.writeFile({ fileName: out });
NODE
node - "$WORK_DIR/import-source.pptx" "$WORK_DIR/import-payload.json" <<'NODE'
const fs = require('fs');
const [input, output] = process.argv.slice(2);
fs.writeFileSync(output, JSON.stringify({
  filename: 'import-source.pptx',
  title: 'Imported Smoke Deck',
  contentBase64: fs.readFileSync(input).toString('base64'),
}));
NODE
import_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/imports/pptx" -H 'content-type: application/json' --data-binary "@$WORK_DIR/import-payload.json")"
import_deck_id="$(printf '%s' "$import_payload" | json_string id)"
[[ -f "$WORK_DIR/data/decks/$import_deck_id/slides.md" ]] || fail "imported deck slides.md was not created"
printf '%s' "$import_payload" | grep -q '"scaffoldKey":"pptx-import"' || fail "imported deck was not flagged as pptx-import"
grep -q 'PPTX import smoke content' "$WORK_DIR/data/decks/$import_deck_id/slides.md" || fail "imported deck did not contain PPTX text"

log "creating deck"
deck_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks" -H 'content-type: application/json' --data '{"title":"Smoke Deck"}')"
deck_id="$(printf '%s' "$deck_payload" | json_string id)"
[[ -f "$WORK_DIR/data/decks/$deck_id/slides.md" ]] || fail "deck slides.md was not created"
printf '%s' "$deck_payload" | grep -q '"scaffoldKey":"commercial-profile"' || fail "deck was not created from commercial-profile scaffold"
[[ -f "$WORK_DIR/data/decks/$deck_id/theme/index.ts" ]] || fail "commercial theme was not copied"
curl -sS -i -H "Host: $deck_id.decks.smoke.test" "http://127.0.0.1:$PORT/" | grep -q '401 Unauthorized' || fail "deck host should require auth"
session_cookie="$(awk '$6 == "slidev_session" { print $7 }' "$COOKIE_JAR" | tail -n 1)"
curl -fsS -H "Host: $deck_id.decks.smoke.test" -H "Cookie: slidev_session=$session_cookie" "http://127.0.0.1:$PORT/" | grep -q '<div id="app">' || fail "authenticated deck host should serve Slidev"
[[ -f "$WORK_DIR/data/draft/$deck_id/.slidev-agent-build.json" ]] || fail "draft preview should write a build manifest"
preview_status_payload="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/decks/$deck_id/preview-build")"
printf '%s' "$preview_status_payload" | grep -Eq '"status":"(fresh|building)"' || {
  printf '[smoke-app] preview status payload: %s\n' "$preview_status_payload" >&2
  fail "draft preview status should be cached or finishing after serving cached build"
}
curl -fsS "http://127.0.0.1:$PORT/internal/tls-check?domain=$deck_id.decks.smoke.test" | grep -q '"ok":true' || fail "tls check should allow existing deck host"
curl -sS -i "http://127.0.0.1:$PORT/internal/tls-check?domain=missing.decks.smoke.test" | grep -q '404 Not Found' || fail "tls check should reject unknown deck host"
basic_deck_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks" -H 'content-type: application/json' --data '{"title":"Basic Smoke Deck","scaffold":"basic"}')"
basic_deck_id="$(printf '%s' "$basic_deck_payload" | json_string id)"
printf '%s' "$basic_deck_payload" | grep -q '"scaffoldKey":"basic"' || fail "deck was not created from selected basic scaffold"
grep -q 'Basic Smoke Deck' "$WORK_DIR/data/decks/$basic_deck_id/slides.md" || fail "basic scaffold title was not applied"
custom_deck_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks" -H 'content-type: application/json' --data '{"title":"Custom Runtime Smoke","scaffold":"custom-html"}')"
custom_deck_id="$(printf '%s' "$custom_deck_payload" | json_string id)"
printf '%s' "$custom_deck_payload" | grep -q '"scaffoldKey":"custom-html"' || fail "deck was not created from custom-html scaffold"
printf '%s' "$custom_deck_payload" | grep -q "\"previewUrl\":\"/runtime/$custom_deck_id/#/1\"" || fail "custom runtime deck should use runtime preview URL"
[[ -f "$WORK_DIR/data/decks/$custom_deck_id/index.html" ]] || fail "custom runtime deck should copy index.html"
[[ -f "$WORK_DIR/data/decks/$custom_deck_id/style.css" ]] || fail "custom runtime deck should copy style.css"
[[ -f "$WORK_DIR/data/decks/$custom_deck_id/deck.js" ]] || fail "custom runtime deck should copy deck.js"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/runtime/$custom_deck_id/" | grep -q 'Custom HTML Deck' || fail "custom runtime route should serve deck index.html"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/runtime/$custom_deck_id/style.css" | grep -q -- '--accent' || fail "custom runtime route should serve style.css"
curl -sS -i "http://127.0.0.1:$PORT/runtime/$custom_deck_id/" | grep -q '401 Unauthorized' || fail "custom runtime route should require auth"
custom_live_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$custom_deck_id/live" -H 'content-type: application/json' --data '{}')"
printf '%s' "$custom_live_payload" | grep -q "\"url\":\"/runtime/$custom_deck_id/#/1\"" || fail "custom runtime live API should return runtime URL"
markdown_export_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/export" -H 'content-type: application/json' --data '{"format":"markdown"}')"
markdown_export_id="$(printf '%s' "$markdown_export_payload" | node -e "const fs=require('fs'); const input=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(input.export.id)")"
[[ -n "$markdown_export_id" ]] || fail "markdown export job id was not returned"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/exports/$markdown_export_id" | grep -q "\"deckId\":\"$deck_id\"" || fail "export metadata should resolve for deck viewer"

log "checking admin deck tools"
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/admin-tools/components" -H 'content-type: application/json' --data '{"name":"SmokeWidget"}' | grep -q '"path":"theme/components/SmokeWidget.vue"' || fail "admin component tool should return created file"
[[ -f "$WORK_DIR/data/decks/$deck_id/theme/components/SmokeWidget.vue" ]] || fail "admin component tool should create file"
preview_status_after_component="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/decks/$deck_id/preview-build")"
printf '%s' "$preview_status_after_component" | grep -Eq '"status":"(building|stale|fresh)"' || fail "admin component change should keep or schedule a draft preview build"
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/admin-tools/layouts" -H 'content-type: application/json' --data '{"name":"smoke-layout"}' | grep -q '"path":"theme/layouts/smoke-layout.vue"' || fail "admin layout tool should return created file"
[[ -f "$WORK_DIR/data/decks/$deck_id/theme/layouts/smoke-layout.vue" ]] || fail "admin layout tool should create file"
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/admin-tools/dependencies" -H 'content-type: application/json' --data '{"name":"left-pad","version":"1.3.0","install":false}' | grep -q '"installed":false' || fail "admin dependency tool should update without install"
grep -q '"left-pad": "1.3.0"' "$WORK_DIR/data/decks/$deck_id/package.json" || fail "admin dependency tool should write package.json"
curl -sS -i -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/admin-tools/dependencies" -H 'content-type: application/json' --data '{"name":"bad;package"}' | grep -q '400 Bad Request' || fail "admin dependency tool should reject invalid package names"
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/admin-tools/restart-preview" -H 'content-type: application/json' --data '{}' | grep -q '"ok":true' || fail "admin preview restart should succeed"
curl -fsS -b "$COOKIE_JAR" -X PATCH "http://127.0.0.1:$PORT/api/decks/$deck_id/agent-settings" -H 'content-type: application/json' --data "{\"agent\":{\"baseUrl\":\"http://127.0.0.1:$AGENT_PORT/v1\",\"memberModel\":\"deck-member-smoke-model\",\"adminModel\":\"deck-admin-smoke-model\",\"timeoutMs\":80000}}" | grep -q '"adminModel":"deck-admin-smoke-model"' || fail "deck agent settings should save admin model override"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/decks/$deck_id/agent-settings" | grep -q '"memberModel":"deck-member-smoke-model"' || fail "deck agent settings should read member model override"

log "creating client share link"
share_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/shares" -H 'content-type: application/json' --data '{"name":"Smoke Client","email":"client@example.com","permission":"view"}')"
share_token="$(printf '%s' "$share_payload" | node -e "const fs=require('fs'); const input=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(input.share.token)")"
[[ -n "$share_token" ]] || fail "share token was not returned"
curl -fsS "http://127.0.0.1:$PORT/api/share/$share_token" | grep -q '"title":"Smoke Deck"' || fail "public share API did not resolve the deck"
curl -fsS "http://127.0.0.1:$PORT/api/share/$share_token" | grep -q "\"url\":\"/client/$share_token\"" || fail "public share API should expose React client URL"
curl -fsS "http://127.0.0.1:$PORT/client/$share_token" | grep -q '<div id="root"></div>' || fail "React client share route should serve the app shell"
curl -sS -i -X POST "http://127.0.0.1:$PORT/api/share/$share_token/instructions" -H 'content-type: application/json' --data '{"instruction":"try to edit a view-only share"}' | grep -q '403 Forbidden' || fail "view-only share should not accept edit instructions"

password_share_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/shares" -H 'content-type: application/json' --data '{"name":"Password Client","email":"password-client@example.com","permission":"view","password":"open-sesame"}')"
password_share_id="$(printf '%s' "$password_share_payload" | node -e "const fs=require('fs'); const input=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(input.share.id)")"
password_share_token="$(printf '%s' "$password_share_payload" | node -e "const fs=require('fs'); const input=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(input.share.token)")"
printf '%s' "$password_share_payload" | grep -q '"hasPassword":true' || fail "password-protected share should report hasPassword"
curl -fsS "http://127.0.0.1:$PORT/api/share/$password_share_token" | grep -q '"passwordRequired":true' || fail "password share API should require password"
curl -fsS "http://127.0.0.1:$PORT/client/$password_share_token" | grep -q '<div id="root"></div>' || fail "password share React route should serve the app shell"
curl -fsS "http://127.0.0.1:$PORT/share/$password_share_token" | grep -q 'Share password required' || fail "password share should show password gate"
curl -sS -i -X POST "http://127.0.0.1:$PORT/api/share/$password_share_token/password" -H 'content-type: application/json' --data '{"password":"wrong"}' | grep -q '403 Forbidden' || fail "wrong share password should be rejected"
curl -fsS -c "$PASSWORD_SHARE_COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/share/$password_share_token/password" -H 'content-type: application/json' --data '{"password":"open-sesame"}' | grep -q '"ok":true' || fail "correct share password should be accepted"
curl -fsS -b "$PASSWORD_SHARE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/share/$password_share_token" | grep -q '"title":"Smoke Deck"' || fail "password share should resolve after password"
curl -fsS -b "$COOKIE_JAR" -X DELETE "http://127.0.0.1:$PORT/api/decks/$deck_id/shares/$password_share_id" >/dev/null
curl -sS -i -b "$PASSWORD_SHARE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/share/$password_share_token" | grep -q '404 Not Found' || fail "revoked share should not resolve"

edit_share_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/shares" -H 'content-type: application/json' --data '{"name":"Smoke Editor","email":"editor@example.com","permission":"edit"}')"
edit_share_token="$(printf '%s' "$edit_share_payload" | node -e "const fs=require('fs'); const input=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(input.share.token)")"
[[ -n "$edit_share_token" ]] || fail "edit share token was not returned"
curl -fsS "http://127.0.0.1:$PORT/api/share/$edit_share_token" | grep -q '"visitorRequired":true' || fail "edit share should require visitor identity"
curl -fsS "http://127.0.0.1:$PORT/api/share/$edit_share_token" | grep -q "\"url\":\"/client/$edit_share_token\"" || fail "edit share API should expose React client URL"
curl -fsS "http://127.0.0.1:$PORT/client/$edit_share_token" | grep -q '<div id="root"></div>' || fail "edit share React route should serve the app shell"
curl -fsS "http://127.0.0.1:$PORT/share/$edit_share_token" | grep -q 'Identify yourself' || fail "edit share should show identity gate before visitor is known"
curl -fsS -c "$SHARE_COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/share/$edit_share_token/visitor" -H 'content-type: application/json' --data '{"name":"Actual Editor","email":"actual-editor@example.com"}' | grep -q '"email":"actual-editor@example.com"' || fail "share visitor identity was not recorded"
curl -fsS -b "$SHARE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/share/$edit_share_token" | grep -q '"visitorRequired":false' || fail "edit share should recognize identified visitor"
curl -fsS -b "$SHARE_COOKIE_JAR" "http://127.0.0.1:$PORT/share/$edit_share_token" | grep -q 'Client workbench' || fail "identified edit share should show client workbench"
curl -fsS -b "$SHARE_COOKIE_JAR" "http://127.0.0.1:$PORT/share/$edit_share_token/deck" | grep -q '<div id="app">' || fail "edit share deck iframe route should serve Slidev"

log "checking deck permission boundary"
invite_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/users/invite" -H 'content-type: application/json' --data '{"email":"employee@example.com","name":"Smoke Employee","role":"employee"}')"
invite_url="$(printf '%s' "$invite_payload" | json_path_string inviteUrl)"
[[ -n "$invite_url" ]] || fail "employee invite URL was not returned"
curl -fsS -c "$EMPLOYEE_COOKIE_JAR" "$invite_url" >/dev/null
curl -fsS -b "$EMPLOYEE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/scaffolds" | grep -q '"key":"commercial-profile"' || fail "employee should see employee templates"
if curl -fsS -b "$EMPLOYEE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/scaffolds" | grep -q '"key":"basic"'; then
  fail "employee should not see admin-only scaffold"
fi
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks" -H 'content-type: application/json' --data '{"title":"Blocked Basic","scaffold":"basic"}' | grep -q '403 Forbidden' || fail "employee should not create from admin-only scaffold"
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/decks/$deck_id" | grep -q '403 Forbidden' || fail "employee should not access admin-owned deck"
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/exports/$markdown_export_id" | grep -q '403 Forbidden' || fail "employee should not access export metadata for another deck"
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/exports/$markdown_export_id/download" | grep -q '403 Forbidden' || fail "employee should not download export for another deck"
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/admin-tools/components" -H 'content-type: application/json' --data '{"name":"BlockedWidget"}' | grep -q '403 Forbidden' || fail "employee should not use admin deck tools"
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" -X PATCH "http://127.0.0.1:$PORT/api/decks/$deck_id/agent-settings" -H 'content-type: application/json' --data '{"agent":{"adminModel":"blocked-model"}}' | grep -q '403 Forbidden' || fail "employee should not update deck agent settings"
employee_id="$(curl -fsS -b "$EMPLOYEE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/auth/me" | node -e "const fs=require('fs'); const input=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(input.user.id)")"
admin_id="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/auth/me" | node -e "const fs=require('fs'); const input=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(input.user.id)")"
curl -sS -i -b "$COOKIE_JAR" -X PATCH "http://127.0.0.1:$PORT/api/users/$admin_id" -H 'content-type: application/json' --data '{"status":"disabled"}' | grep -q '400 Bad Request' || fail "admin user update should preserve at least one active admin"
curl -fsS -b "$COOKIE_JAR" -X PATCH "http://127.0.0.1:$PORT/api/users/$employee_id" -H 'content-type: application/json' --data '{"role":"admin"}' | grep -q '"role":"admin"' || fail "admin should promote employee role"
curl -fsS -b "$COOKIE_JAR" -X PATCH "http://127.0.0.1:$PORT/api/users/$employee_id" -H 'content-type: application/json' --data '{"role":"employee"}' | grep -q '"role":"employee"' || fail "admin should demote employee role"
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/collaborators" -H 'content-type: application/json' --data '{"email":"employee@example.com","role":"viewer"}' | grep -q '"role":"viewer"' || fail "collaborator was not added by email"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/decks/$deck_id/collaborators" | grep -q '"email":"employee@example.com"' || fail "collaborator list should include user details"
curl -fsS -b "$EMPLOYEE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/decks/$deck_id" | grep -q '"title":"Smoke Deck"' || fail "viewer collaborator should access deck"
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/lock" -H 'content-type: application/json' --data '{}' | grep -q '403 Forbidden' || fail "viewer collaborator should not acquire edit lock"
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/collaborators" -H 'content-type: application/json' --data "{\"userId\":\"$employee_id\",\"role\":\"editor\"}" | grep -q '"role":"editor"' || fail "collaborator was not upgraded to editor"
curl -fsS -b "$COOKIE_JAR" -X DELETE "http://127.0.0.1:$PORT/api/decks/$deck_id/collaborators/$employee_id" >/dev/null
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/decks/$deck_id" | grep -q '403 Forbidden' || fail "removed collaborator should lose deck access"
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/collaborators" -H 'content-type: application/json' --data "{\"userId\":\"$employee_id\",\"role\":\"editor\"}" | grep -q '"role":"editor"' || fail "collaborator was re-added as editor"

log "checking single active editor lock"
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/lock" -H 'content-type: application/json' --data '{}' | grep -q "\"activeEditorUserId\"" || fail "admin should acquire edit lock"
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/lock" -H 'content-type: application/json' --data '{}' | grep -q '409 Conflict' || fail "second editor should not acquire active lock"
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/instructions" -H 'content-type: application/json' --data '{"instruction":"employee tries to edit while locked"}' | grep -q '409 Conflict' || fail "second editor should not edit while lock is held"
curl -fsS -b "$COOKIE_JAR" -X DELETE "http://127.0.0.1:$PORT/api/decks/$deck_id/lock" >/dev/null
curl -fsS -b "$EMPLOYEE_COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/lock" -H 'content-type: application/json' --data '{}' | grep -q "\"activeEditorUserId\":\"$employee_id\"" || fail "employee editor should acquire released lock"
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/instructions" -H 'content-type: application/json' --data '{"instruction":"edit package.json and add a dependency"}' | grep -q '403 Forbidden' || fail "member agent should not edit package metadata"
curl -sS -i -b "$EMPLOYEE_COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/instructions" -H 'content-type: application/json' --data '{"instruction":"read /etc/passwd before editing the deck"}' | grep -q '403 Forbidden' || fail "member agent should not access host filesystem paths"
curl -fsS -b "$EMPLOYEE_COOKIE_JAR" -X DELETE "http://127.0.0.1:$PORT/api/decks/$deck_id/lock" >/dev/null
curl -fsS -b "$COOKIE_JAR" -X PATCH "http://127.0.0.1:$PORT/api/users/$employee_id" -H 'content-type: application/json' --data '{"status":"disabled"}' | grep -q '"status":"disabled"' || fail "admin should disable employee"
curl -fsS -b "$EMPLOYEE_COOKIE_JAR" "http://127.0.0.1:$PORT/api/auth/me" | grep -q '"user":null' || fail "disabled employee session should be revoked"
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/lock" -H 'content-type: application/json' --data '{}' | grep -q '"role":"user"\|"messages"' || fail "admin should reacquire edit lock"
guard_runs_payload="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/api/decks/$deck_id/runs")"
printf '%s' "$guard_runs_payload" | grep -q '"status":"error"' || fail "member guard failures should be recorded as errored runs"
printf '%s' "$guard_runs_payload" | grep -q 'Member agent cannot access package metadata' || fail "package metadata guard run should be recorded"
printf '%s' "$guard_runs_payload" | grep -q 'Member agent cannot access host filesystem paths' || fail "host filesystem guard run should be recorded"
curl -fsS -b "$COOKIE_JAR" -X DELETE "http://127.0.0.1:$PORT/api/decks/$deck_id/lock" >/dev/null

log "checking live preview API boundary"
curl -sS -i -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/live" | grep -q '401 Unauthorized' || fail "live preview API should require auth"
live_payload="$(curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/live" -H 'content-type: application/json' --data '{}')"
printf '%s' "$live_payload" | grep -q "\"url\":\"http://$deck_id.decks.smoke.test/#/1\"" || fail "deck-domain workbench live preview should return deck host URL"
curl -sS -i -b "$COOKIE_JAR" "http://127.0.0.1:$PORT/live/$deck_id/2" | tr -d '\r' | grep -qi "location: /live/$deck_id/#/2" || fail "live slide-number routes should redirect to hash mode"
curl -sS -i -X POST "http://127.0.0.1:$PORT/api/decks/$deck_id/messages" -H 'content-type: application/json' --data '{"instruction":"test"}' | grep -q '401 Unauthorized' || fail "streaming message API should require auth"

log "app smoke passed"
