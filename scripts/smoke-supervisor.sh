#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${SMOKE_SUPERVISOR_WORK_DIR:-/tmp/slidev-agent-platform-supervisor-smoke}"
PORT_START="${SMOKE_SUPERVISOR_PORT_START:-$(node -e "const net=require('net'); const s=net.createServer(); s.listen(0,'127.0.0.1',()=>{console.log(s.address().port); s.close();});")}"

log() {
  printf '[smoke-supervisor] %s\n' "$*"
}

fail() {
  printf '[smoke-supervisor] ERROR: %s\n' "$*" >&2
  exit 1
}

log "building server"
npm --prefix "$ROOT_DIR" run build:server >/dev/null
grep -q "routerMode: 'hash'" "$ROOT_DIR/apps/server/dist/preview/slidevPreviewRunner.js" || fail "live preview runner should force hash router mode"
grep -q "slidev-agent-force-hash-route" "$ROOT_DIR/apps/server/dist/preview/slidevPreviewRunner.js" || fail "live preview runner should patch Slidev client hash routing"
grep -Fq 'return `/${path}`;' "$ROOT_DIR/apps/server/dist/preview/slidevPreviewRunner.js" || fail "live preview runner should patch Slidev slide paths for hash routing"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/bin" "$WORK_DIR/deck-a" "$WORK_DIR/deck-b"
printf '# Smoke deck\n' >"$WORK_DIR/deck-a/slides.md"
printf '# Smoke deck\n' >"$WORK_DIR/deck-b/slides.md"

cat >"$WORK_DIR/fake-preview-runner.cjs" <<'NODE'
#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
const entry = arg('--entry');
const port = Number(args[args.indexOf('--port') + 1]);
const base = arg('--base');
const hmrHost = arg('--hmr-host');
const hmrProtocol = arg('--hmr-protocol');
const hmrClientPort = arg('--hmr-client-port');
const hmrPath = arg('--hmr-path');
const previewMode = process.env.EXPECT_PREVIEW_MODE ?? 'deck-domain';
if (!entry?.endsWith('/.slidev-agent-live.md')) {
  console.error(`expected --entry .slidev-agent-live.md, got ${entry}`);
  process.exit(2);
}
if (!/^routerMode:\s*hash$/m.test(fs.readFileSync(entry, 'utf8'))) {
  console.error(`expected live entry to force routerMode hash`);
  process.exit(2);
}
if (previewMode === 'deck-domain') {
  if (base !== '/') {
    console.error(`expected --base /, got ${base}`);
    process.exit(2);
  }
  if (!hmrHost?.endsWith('.decks.example.test') || hmrProtocol !== 'wss' || hmrClientPort !== '443' || hmrPath !== '/__hmr') {
    console.error(`bad hmr args: ${JSON.stringify({ hmrHost, hmrProtocol, hmrClientPort, hmrPath })}`);
    process.exit(2);
  }
} else if (previewMode === 'local') {
  if (base !== '/') {
    console.error(`expected local --base /, got ${base}`);
    process.exit(2);
  }
  if (hmrHost || hmrProtocol || hmrClientPort || hmrPath) {
    console.error(`expected local preview to use native Vite HMR, got ${JSON.stringify({ hmrHost, hmrProtocol, hmrClientPort, hmrPath })}`);
    process.exit(2);
  }
} else {
  console.error(`unknown EXPECT_PREVIEW_MODE ${previewMode}`);
  process.exit(2);
}
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<div id="app">fake slidev</div>');
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
NODE
chmod +x "$WORK_DIR/fake-preview-runner.cjs"

log "checking supervisor capacity and idle reap"
node --input-type=module - "$ROOT_DIR" "$WORK_DIR" "$PORT_START" <<'NODE'
const root = process.argv[2];
const workDir = process.argv[3];
const portStart = Number(process.argv[4]);
const { LivePreviewSupervisor } = await import(`file://${root}/apps/server/dist/preview/livePreview.js`);
process.env.SLIDEV_AGENT_PREVIEW_RUNNER = `${workDir}/fake-preview-runner.cjs`;

const config = {
  publicBaseUrl: 'https://app.example.test',
  decksDomain: 'decks.example.test',
  livePreview: {
    portPoolStart: portStart,
    portPoolEnd: portStart,
    maxConcurrentDecks: 1,
    deckIdleTimeoutMs: 250,
    crashRetryLimit: 2,
    crashRetryDelayMs: 100,
  },
};

const supervisor = new LivePreviewSupervisor(config);
try {
	  const first = await supervisor.start('deck-a', `${workDir}/deck-a`, `${workDir}/deck-a/slides.md`);
		  if (first.status !== 'running') throw new Error(`expected deck-a running, got ${first.status}`);
		  if (first.url !== 'https://deck-a.decks.example.test/#/1') throw new Error(`expected deck-domain preview URL, got ${first.url}`);
		  if (first.hmr?.path !== '/__hmr' || first.hmr?.clientPort !== 443 || first.hmr?.protocol !== 'wss') throw new Error(`expected deck-domain hmr config, got ${JSON.stringify(first.hmr)}`);
		  if (supervisor.list().length !== 1) throw new Error('expected one live preview after first start');

  const second = await supervisor.start('deck-b', `${workDir}/deck-b`, `${workDir}/deck-b/slides.md`);
  if (second.status !== 'running') throw new Error(`expected deck-b running, got ${second.status}`);
  const afterEvict = supervisor.list();
  if (afterEvict.length !== 1 || afterEvict[0].deckId !== 'deck-b') {
    throw new Error(`expected LRU eviction to leave deck-b, got ${JSON.stringify(afterEvict)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 700));
  if (supervisor.list().length !== 0) {
    throw new Error(`expected idle preview to be reaped, got ${JSON.stringify(supervisor.list())}`);
  }
} finally {
  await supervisor.stopAll();
}
NODE

log "checking local hmr settings"
EXPECT_PREVIEW_MODE=local node --input-type=module - "$ROOT_DIR" "$WORK_DIR" "$((PORT_START + 1))" <<'NODE'
const root = process.argv[2];
const workDir = process.argv[3];
const portStart = Number(process.argv[4]);
const { LivePreviewSupervisor } = await import(`file://${root}/apps/server/dist/preview/livePreview.js`);
process.env.SLIDEV_AGENT_PREVIEW_RUNNER = `${workDir}/fake-preview-runner.cjs`;

const config = {
  publicBaseUrl: 'http://127.0.0.1:4321',
  livePreview: {
    portPoolStart: portStart,
    portPoolEnd: portStart,
    maxConcurrentDecks: 1,
    deckIdleTimeoutMs: 1000,
    crashRetryLimit: 0,
    crashRetryDelayMs: 100,
  },
};

const supervisor = new LivePreviewSupervisor(config);
try {
  const preview = await supervisor.start('deck-local', `${workDir}/deck-a`, `${workDir}/deck-a/slides.md`);
  if (preview.status !== 'running') throw new Error(`expected local preview running, got ${preview.status}`);
  if (preview.url !== `http://127.0.0.1:${portStart}/#/1`) throw new Error(`expected direct local preview URL, got ${preview.url}`);
  if (preview.hmr) throw new Error(`expected native local hmr config, got ${JSON.stringify(preview.hmr)}`);
  await (await import('node:fs/promises')).writeFile(`${workDir}/deck-a/slides.md`, '---\ntitle: Changed\n---\n\n# Changed\n', 'utf8');
  await supervisor.refresh('deck-local', `${workDir}/deck-a`, `${workDir}/deck-a/slides.md`);
  const liveEntry = await (await import('node:fs/promises')).readFile(`${workDir}/deck-a/.slidev-agent-live.md`, 'utf8');
  if (!liveEntry.includes('# Changed')) throw new Error('expected reused live preview entry to refresh after markdown changes');
  await supervisor.stop('deck-local');
  await (await import('node:fs/promises')).writeFile(`${workDir}/deck-a/slides.md`, '---\ntitle: Changed Again\n---\n\n# Changed Again\n', 'utf8');
  await supervisor.refresh('deck-local', `${workDir}/deck-a`, `${workDir}/deck-a/slides.md`);
  const refreshedWithoutProcess = await (await import('node:fs/promises')).readFile(`${workDir}/deck-a/.slidev-agent-live.md`, 'utf8');
  if (!refreshedWithoutProcess.includes('# Changed Again')) throw new Error('expected live preview entry to refresh even when no preview process is tracked');
} finally {
  await supervisor.stopAll();
}
NODE

cat >"$WORK_DIR/crashy-preview-runner.cjs" <<'NODE'
#!/usr/bin/env node
const fs = require('fs');
const http = require('http');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const statePath = process.env.CRASHY_PREVIEW_STATE;
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { starts: 0 };
state.starts += 1;
fs.writeFileSync(statePath, JSON.stringify(state));
if (state.starts === 1) {
  console.error('intentional first-start crash');
  process.exit(7);
}
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<div id="app">restarted slidev</div>');
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
NODE
chmod +x "$WORK_DIR/crashy-preview-runner.cjs"

log "checking crash retry"
node --input-type=module - "$ROOT_DIR" "$WORK_DIR" "$((PORT_START + 1))" <<'NODE'
const root = process.argv[2];
const workDir = process.argv[3];
const portStart = Number(process.argv[4]);
const { LivePreviewSupervisor } = await import(`file://${root}/apps/server/dist/preview/livePreview.js`);
process.env.SLIDEV_AGENT_PREVIEW_RUNNER = `${workDir}/crashy-preview-runner.cjs`;
process.env.CRASHY_PREVIEW_STATE = `${workDir}/crashy-state.json`;
const config = {
  publicBaseUrl: 'https://app.example.test',
  decksDomain: 'decks.example.test',
  livePreview: {
    portPoolStart: portStart,
    portPoolEnd: portStart,
    maxConcurrentDecks: 1,
    deckIdleTimeoutMs: 1000,
    crashRetryLimit: 2,
    crashRetryDelayMs: 100,
  },
};
const supervisor = new LivePreviewSupervisor(config);
try {
  await supervisor.start('deck-a', `${workDir}/deck-a`, `${workDir}/deck-a/slides.md`).catch(() => null);
  let restarted;
  for (let i = 0; i < 20; i += 1) {
    restarted = supervisor.get('deck-a');
    if (restarted?.status === 'running' && restarted.restartAttempts === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (restarted?.status !== 'running' || restarted.restartAttempts !== 1) {
    throw new Error(`expected restarted preview after crash, got ${JSON.stringify(restarted)}`);
  }
  const state = JSON.parse(await (await import('node:fs/promises')).readFile(`${workDir}/crashy-state.json`, 'utf8'));
  if (state.starts !== 2) throw new Error(`expected exactly two starts, got ${JSON.stringify(state)}`);
} finally {
  await supervisor.stopAll();
}
NODE

log "supervisor smoke passed"
