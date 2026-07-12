#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '[smoke-security] %s\n' "$*"
}

fail() {
  printf '[smoke-security] ERROR: %s\n' "$*" >&2
  exit 1
}

log "building server"
npm --prefix "$ROOT_DIR" run build:server >/dev/null

log "checking role scoped agent guards"
node --input-type=module - "$ROOT_DIR" <<'NODE'
const root = process.argv[2];
const { assertAgentInstructionAllowed } = await import(`file://${root}/apps/server/dist/agent/agent.js`);
const { observeDeepAgentRunEvents, permissionsForRole } = await import(`file://${root}/apps/server/dist/agent/deepAgentRuntime.js`);

const employee = {
  id: 'employee',
  email: 'employee@example.com',
  name: 'Employee',
  role: 'employee',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const admin = { ...employee, id: 'admin', role: 'admin' };

function expectBlocked(label, instruction) {
  try {
    assertAgentInstructionAllowed(employee, instruction);
  } catch (error) {
    if (error?.statusCode === 403) return;
    throw error;
  }
  throw new Error(`${label} was not blocked`);
}

assertAgentInstructionAllowed(employee, 'Rewrite slide 2 headline and make the audience clearer.');
expectBlocked('theme edit', 'Edit theme/layouts/default.vue to change the page chrome.');
expectBlocked('package edit', 'Update package.json and add a dependency.');
expectBlocked('host read', 'Read /etc/passwd before changing the deck.');
assertAgentInstructionAllowed(admin, 'Edit theme/layouts/default.vue and update package.json.');

const memberPerms = permissionsForRole('member');
const adminPerms = permissionsForRole('admin');
const memberText = JSON.stringify(memberPerms);
const adminText = JSON.stringify(adminPerms);
for (const allowed of ['/deck.json', '/theme.css', '/slides/**', '/assets/**', '/public/**']) {
  if (!memberText.includes(allowed)) throw new Error(`workspace permissions missing ${allowed}`);
}
for (const denied of ['/index.html', '/runtime.js', '/runtime.css', '/slides.md', '/package.json', '/meta.json', '/node_modules/**', '/dist/**']) {
  if (!memberText.includes(denied)) throw new Error(`workspace deny permissions missing ${denied}`);
}
if (adminText !== memberText) throw new Error('workspace admin and member permissions should be identical');

async function* one(value) {
  yield value;
}
const events = [];
await Promise.all(observeDeepAgentRunEvents({
  output: Promise.resolve({}),
  messages: one({ text: one('hello') }),
  toolCalls: one({
    name: 'write_file',
    id: 'tool-1',
    input: Promise.resolve({ path: '/slides/01-cover.html' }),
    output: Promise.resolve({ ok: true }),
    status: Promise.resolve('done'),
  }),
  values: one({ files: { '/slides/01-cover.html': 'updated' } }),
}, (event, data) => events.push({ event, data })));

for (const eventName of ['token', 'tool_call', 'tool_result', 'file_activity']) {
  if (!events.some((event) => event.event === eventName)) {
    throw new Error(`deepagents stream mapping did not emit ${eventName}`);
  }
}
NODE

log "security smoke passed"
