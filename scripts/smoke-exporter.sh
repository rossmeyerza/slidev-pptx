#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${SMOKE_EXPORTER_WORK_DIR:-/tmp/slidev-agent-platform-exporter-smoke}"

log() {
  printf '[smoke-exporter] %s\n' "$*"
}

fail() {
  printf '[smoke-exporter] ERROR: %s\n' "$*" >&2
  exit 1
}

log "building server"
npm --prefix "$ROOT_DIR" run build:server >/dev/null

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/data/jobs" "$WORK_DIR/data/exports"

log "checking interrupted export reconciliation"
(
  cd "$ROOT_DIR"
  node --input-type=module - "$ROOT_DIR" "$WORK_DIR" <<'NODE'
const root = process.argv[2];
const workDir = process.argv[3];
const fs = await import('node:fs/promises');
const { ExportService } = await import(`file://${root}/apps/server/dist/export/exporter.js`);
const metaUpdates = [];
const staleQueuedId = '11111111-1111-4111-8111-111111111111';
const staleRunningId = '22222222-2222-4222-8222-222222222222';
const now = new Date().toISOString();
const config = {
  repoRoot: `${workDir}/repo`,
  dataDir: `${workDir}/data`,
  export: { concurrency: 1, timeoutMs: 5000 },
  import: { timeoutMs: 5000 },
};
const decks = {
  async get(deckId) {
    const markdown = deckId === 'deck-a' ? '# Deck A\n---\n# Slide 2\n' : '# Deck B\n---\n# Slide 2\n';
    return { meta: { id: deckId }, markdown };
  },
  deckFile(deckId) {
    return `${workDir}/decks/${deckId === 'deck-a' ? 'a' : 'b'}/slides.md`;
  },
  deckPath(deckId) {
    return `${workDir}/decks/${deckId === 'deck-a' ? 'a' : 'b'}`;
  },
  async updateMeta(deckId, patch) {
    metaUpdates.push({ deckId, patch });
    return { id: deckId, ...patch };
  },
};
await fs.writeFile(`${workDir}/data/jobs/${staleQueuedId}.json`, JSON.stringify({
  id: staleQueuedId,
  deckId: 'deck-a',
  format: 'pptx',
  status: 'queued',
  createdAt: now,
  updatedAt: now,
  mode: 'screenshot',
}, null, 2));
await fs.writeFile(`${workDir}/data/jobs/${staleRunningId}.json`, JSON.stringify({
  id: staleRunningId,
  deckId: 'deck-b',
  format: 'pptx',
  status: 'running',
  createdAt: now,
  updatedAt: now,
  mode: 'screenshot',
}, null, 2));
const exports = new ExportService(config, decks);
await exports.whenReady();
const staleQueued = await exports.get(staleQueuedId);
const staleRunning = await exports.get(staleRunningId);
if (staleQueued.status !== 'failed' || staleRunning.status !== 'failed') {
  throw new Error(`expected stale jobs to fail on startup, got ${staleQueued.status}/${staleRunning.status}`);
}
if (!/interrupted/.test(staleQueued.error ?? '') || !/interrupted/.test(staleRunning.error ?? '')) {
  throw new Error(`expected stale job interruption messages, got ${staleQueued.error}/${staleRunning.error}`);
}
if (metaUpdates.filter((update) => update.patch.pptx?.status === 'failed').length !== 2) {
  throw new Error(`expected failed stale deck meta updates, got ${JSON.stringify(metaUpdates)}`);
}
NODE
)

log "exporter smoke passed"
