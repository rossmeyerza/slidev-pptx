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
mkdir -p "$WORK_DIR/repo/dist/slidev-to-pptx" "$WORK_DIR/data/jobs" "$WORK_DIR/data/exports" "$WORK_DIR/decks/a" "$WORK_DIR/decks/b"
printf '%s\n' '# Deck A' '---' '# Slide 2' >"$WORK_DIR/decks/a/slides.md"
printf '%s\n' '# Deck B' '---' '# Slide 2' >"$WORK_DIR/decks/b/slides.md"

cat >"$WORK_DIR/repo/dist/slidev-to-pptx/cli.js" <<'NODE'
#!/usr/bin/env node
import { promises as fs } from 'node:fs';
const outputPath = process.argv[3];
const statePath = process.env.EXPORT_SMOKE_STATE;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function readState() {
  return JSON.parse(await fs.readFile(statePath, 'utf8').catch(() => '{"active":0,"maxActive":0,"runs":0}'));
}
async function writeState(state) {
  await fs.writeFile(statePath, JSON.stringify(state), 'utf8');
}
const state = await readState();
state.active += 1;
state.runs += 1;
state.maxActive = Math.max(state.maxActive, state.active);
await writeState(state);
if (state.active > 1) {
  console.error('export concurrency exceeded');
  process.exit(2);
}
await sleep(300);
await fs.writeFile(outputPath, 'fake pptx', 'utf8');
const after = await readState();
after.active -= 1;
await writeState(after);
NODE
chmod +x "$WORK_DIR/repo/dist/slidev-to-pptx/cli.js"

cat >"$WORK_DIR/repo/dist/slidev-to-pptx/verify.js" <<'NODE'
#!/usr/bin/env node
console.log('\n=== slidev-to-pptx verify ===\n');
console.log('PPTX:      fake');
console.log('Slides:    2');
console.log('Images:    2');
console.log('Image dim: 1920x1080');
console.log('\nVerification passed.');
NODE
chmod +x "$WORK_DIR/repo/dist/slidev-to-pptx/verify.js"

log "checking queued exports and verification metadata"
(
  cd "$ROOT_DIR"
  EXPORT_SMOKE_STATE="$WORK_DIR/state.json" node --input-type=module - "$ROOT_DIR" "$WORK_DIR" <<'NODE'
const root = process.argv[2];
const workDir = process.argv[3];
const fs = await import('node:fs/promises');
const { ExportService } = await import(`file://${root}/apps/server/dist/export/exporter.js`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
const first = await exports.start('deck-a', { format: 'pptx', mode: 'screenshot' });
const second = await exports.start('deck-b', { format: 'pptx', mode: 'screenshot' });
if (first.status !== 'queued' || second.status !== 'queued') throw new Error('exports should start queued');

let firstDone;
let secondDone;
for (let i = 0; i < 40; i += 1) {
  firstDone = await exports.get(first.id);
  secondDone = await exports.get(second.id);
  if (firstDone.status === 'succeeded' && secondDone.status === 'succeeded') break;
  await sleep(100);
}
if (firstDone?.status !== 'succeeded' || secondDone?.status !== 'succeeded') {
  throw new Error(`expected both exports to succeed, got ${firstDone?.status}/${secondDone?.status}`);
}
if (firstDone.verification?.slideCount !== 2 || firstDone.verification?.imageCount !== 2) {
  throw new Error(`expected verification metadata, got ${JSON.stringify(firstDone.verification)}`);
}
const state = JSON.parse(await (await import('node:fs/promises')).readFile(`${workDir}/state.json`, 'utf8'));
if (state.maxActive !== 1 || state.runs !== 2) {
  throw new Error(`expected queued serial execution, got ${JSON.stringify(state)}`);
}
if (metaUpdates.filter((update) => update.patch.pptx?.status === 'failed').length !== 2) {
  throw new Error(`expected failed stale deck meta updates, got ${JSON.stringify(metaUpdates)}`);
}
if (metaUpdates.filter((update) => update.patch.pptx?.status === 'succeeded').length !== 2) {
  throw new Error(`expected successful deck meta updates, got ${JSON.stringify(metaUpdates)}`);
}
NODE
)

log "exporter smoke passed"
