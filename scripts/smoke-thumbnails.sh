#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${SMOKE_THUMBNAILS_WORK_DIR:-/tmp/deckhand-thumbnails-smoke}"

log() {
  printf '[smoke-thumbnails] %s\n' "$*"
}

log "building server"
npm --prefix "$ROOT_DIR" run build:server >/dev/null

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

log "capturing commercial-html slide 1"
node --input-type=module - "$ROOT_DIR" "$WORK_DIR/thumbnail.png" <<'NODE'
import { readFile, stat } from 'node:fs/promises';
const root = process.argv[2];
const output = process.argv[3];
const { generateThumbnail } = await import(`file://${root}/apps/server/dist/export/htmlDeckExporter.js`);
await generateThumbnail(`${root}/themes/commercial-html`, `${root}/runtime`, output);
const info = await stat(output);
if (!info.isFile() || info.size === 0) throw new Error('Thumbnail output is missing or empty');
const data = await readFile(output);
if (!data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) throw new Error('Thumbnail output is not a PNG');
NODE

log "thumbnail smoke passed"
