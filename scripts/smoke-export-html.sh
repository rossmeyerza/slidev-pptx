#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${SMOKE_EXPORT_HTML_WORK_DIR:-/tmp/slidev-agent-platform-export-html-smoke}"

log() {
  printf '[smoke-export-html] %s\n' "$*"
}

log "building server"
npm --prefix "$ROOT_DIR" run build:server >/dev/null

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/deck"
cp -R "$ROOT_DIR/themes/custom-html/." "$WORK_DIR/deck/"
for shell_file in index.html runtime.js runtime.css; do
  cp "$ROOT_DIR/runtime/$shell_file" "$WORK_DIR/deck/$shell_file"
done

log "exporting three-slide HTML deck to PPTX and PDF"
node --input-type=module - "$ROOT_DIR" "$WORK_DIR" <<'NODE'
import { readFile } from 'node:fs/promises';
const root = process.argv[2];
const work = process.argv[3];
const { exportHtmlDeck } = await import(`file://${root}/apps/server/dist/export/htmlDeckExporter.js`);
const common = { deckDir: `${work}/deck`, shellDir: `${root}/runtime`, scale: 2 };
const pptx = await exportHtmlDeck({ ...common, format: 'pptx', outputPath: `${work}/deck.pptx` });
if (pptx.slideCount !== 3 || !pptx.verification?.ok) throw new Error(`PPTX verification failed: ${JSON.stringify(pptx)}`);
if (pptx.verification.expectedImageWidth !== 2560 || pptx.verification.expectedImageHeight !== 1440) {
  throw new Error(`Unexpected screenshot dimensions: ${JSON.stringify(pptx.verification)}`);
}
const pdf = await exportHtmlDeck({ ...common, format: 'pdf', outputPath: `${work}/deck.pdf` });
if (pdf.slideCount !== 3) throw new Error(`Expected 3 PDF slides, got ${pdf.slideCount}`);
if (!(await readFile(`${work}/deck.pdf`)).length) throw new Error('PDF is empty');
console.log(`PPTX: ${pptx.slideCount} slides, ${pptx.verification.imageCount} images, ${pptx.verification.expectedImageWidth}x${pptx.verification.expectedImageHeight}`);
console.log(`PDF: ${pdf.slideCount} pages`);
NODE

log "HTML export smoke passed"
