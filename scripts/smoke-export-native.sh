#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${SMOKE_EXPORT_NATIVE_WORK_DIR:-/tmp/slidev-agent-platform-export-native-smoke}"

log() {
  printf '[smoke-export-native] %s\n' "$*"
}

log "building server"
npm --prefix "$ROOT_DIR" run build:server >/dev/null

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

log "exporting four-slide commercial HTML deck to editable PPTX"
node --input-type=module - "$ROOT_DIR" "$WORK_DIR" <<'NODE'
import { readFile, stat } from 'node:fs/promises';
import JSZip from 'jszip';

const root = process.argv[2];
const work = process.argv[3];
const outputPath = `${work}/deck-native.pptx`;
const { exportNativePptx } = await import(`file://${root}/apps/server/dist/export/htmlDeckNativeExporter.js`);
const result = await exportNativePptx({
  deckDir: `${root}/themes/commercial-html`,
  shellDir: `${root}/runtime`,
  outputPath,
});
const info = await stat(outputPath);
if (!info.isFile() || info.size <= 0) throw new Error('Native PPTX is missing or empty');
const zip = await JSZip.loadAsync(await readFile(outputPath));
let textRuns = 0;
for (let slideNumber = 1; slideNumber <= 4; slideNumber += 1) {
  const name = `ppt/slides/slide${slideNumber}.xml`;
  const file = zip.file(name);
  if (!file) throw new Error(`Missing ${name}`);
  const xml = await file.async('string');
  textRuns += xml.match(/<a:t>/g)?.length ?? 0;
}
if (textRuns <= 0) throw new Error('Native PPTX contains no editable text runs');
if (result.slideCount !== 4 || !result.verification.ok) throw new Error(`Native verification failed: ${JSON.stringify(result)}`);
console.log(`PPTX: ${result.slideCount} slides, ${textRuns} XML text runs, ${result.verification.images} images, ${result.verification.rects} rectangles`);
NODE

log "native export smoke passed"
