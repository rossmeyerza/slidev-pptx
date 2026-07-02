#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/themes/basic"
WORK_DIR="${SMOKE_WORK_DIR:-/tmp/slidev-agent-platform-basic-smoke}"
DECK_DIR="$WORK_DIR/basic"
PORT="${SMOKE_PORT:-3045}"

log() {
  printf '[smoke-basic] %s\n' "$*"
}

fail() {
  printf '[smoke-basic] ERROR: %s\n' "$*" >&2
  exit 1
}

find_slidev() {
  if command -v slidev >/dev/null 2>&1; then
    printf 'slidev'
    return 0
  fi

  if npx --no-install slidev --version >/dev/null 2>&1; then
    printf 'npx --no-install slidev'
    return 0
  fi

  return 1
}

run_slidev() {
  local slidev_cmd="$1"
  shift
  # shellcheck disable=SC2086
  $slidev_cmd "$@"
}

require_file() {
  local file="$1"
  [[ -f "$file" ]] || fail "missing required file: $file"
}

log "creating deck workspace at $DECK_DIR"
rm -rf "$DECK_DIR"
mkdir -p "$WORK_DIR"
cp -R "$SOURCE_DIR" "$DECK_DIR"
if [[ -d "$ROOT_DIR/node_modules" ]]; then
  ln -s "$ROOT_DIR/node_modules" "$DECK_DIR/node_modules"
fi

require_file "$DECK_DIR/slides.md"
require_file "$DECK_DIR/package.json"
require_file "$DECK_DIR/assets/agent-platform-mark.svg"

grep -q './assets/agent-platform-mark.svg' "$DECK_DIR/slides.md" || fail "slides.md does not reference the local SVG asset"
grep -q 'Slidev Agent Platform' "$DECK_DIR/slides.md" || fail "slides.md is missing the scaffold title"
grep -q 'Export Check' "$DECK_DIR/slides.md" || fail "slides.md is missing the export smoke slide"
log "create deck check passed"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  log "root node_modules is missing; converter build, publish, and PPTX export checks skipped"
  log "run npm install, then rerun this script for full verification"
  exit 0
fi

log "building converter"
npm --prefix "$ROOT_DIR" run build

slidev_cmd="$(find_slidev || true)"
if [[ -z "$slidev_cmd" ]]; then
  log "Slidev CLI is not installed locally or on PATH; publish and PPTX export checks skipped"
  log "install/provide Slidev externally, then rerun this script"
  exit 0
fi

if [[ ! -d "$DECK_DIR/node_modules/@slidev/theme-default" && ! -d "$ROOT_DIR/node_modules/@slidev/theme-default" ]]; then
  log "Slidev CLI is available, but @slidev/theme-default is not installed; publish and PPTX export checks skipped"
  log "install the scaffold dependencies, then rerun this script for full Slidev verification"
  exit 0
fi

log "publishing static Slidev site"
run_slidev "$slidev_cmd" build "$DECK_DIR/slides.md" --out "$DECK_DIR/dist"
require_file "$DECK_DIR/dist/index.html"
log "publish check passed"

log "exporting PPTX"
node "$ROOT_DIR/bin/slidev-to-pptx.js" "$DECK_DIR/slides.md" "$DECK_DIR/dist/basic.pptx" --port "$PORT" --timeout 90000
require_file "$DECK_DIR/dist/basic.pptx"

log "verifying PPTX"
node "$ROOT_DIR/bin/slidev-to-pptx-verify.js" "$DECK_DIR/dist/basic.pptx" --slides 5 --scale 2
log "PPTX export check passed"
