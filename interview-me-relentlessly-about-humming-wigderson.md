# Slidev Agent Platform — Detailed Build Plan

> Self-contained build spec. A build-agent should be able to execute this without the originating conversation. All library facts were web-verified (see “Verified stack facts”). Reuse the two reference repos noted under “Critical reference files” — do not rebuild them.

---

## 1. Context

**Problem.** The world still trades PowerPoints, but LLMs author `.pptx` poorly and HTML beautifully. Slidev (markdown + Vue, Vite dev server with HMR) is the ideal substrate: agents edit it well, it renders beautifully, and its themes give brand control. The opportunity: wrap Slidev in a product so **non-technical employees build on-brand decks by chatting with an agent**, see edits hot-reload live, collaborate, share a URL with clients, and export to `.pptx` for the PowerPoint world.

**Existing reusable assets (this is greenfield product code; these are inputs):**
- Bidirectional converter at `/home/ross/Documents/developer/slidev-pptx` (`slidev-to-pptx`: screenshot/editable/hybrid; `pptx-to-slidev`: minimal scaffold). **Reuse.**
- Reference deck/theme at `/home/ross/Documents/developer/omni_hub/slidev-commercial-profile/app` (custom `theme/` with Vue layouts + ApexCharts components + TCCC design tokens + local fonts). **Becomes the first theme scaffold.**
- `quanta_1` itself (PptxGenJS/python-pptx generators + marimo dashboard) is **out of scope**.

**Outcome.** A multi-user web app (single org, future-proofed for multi-tenant): employees create decks from admin-curated themes, edit by chatting with a role-scoped agent, watch a live HMR preview, invite collaborators, share view/edit links to clients, and export to PPTX.

---

## 2. Locked decisions

| # | Decision |
|---|----------|
| 1 | **Single org**, future-proofed: `org_id` on every tenant-scoped table; no org-management UI in v1. |
| 2 | **Process-per-deck on one DigitalOcean VPS** (no Docker in v1). Agent gets curated, **path-jailed** tools (no raw shell). v2 = containers. |
| 3 | Agent framework: **`deepagents`** (LangGraph.js-based). |
| 4 | Frontend: **React SPA + TanStack Query** (plain Vite SPA). **JSDoc, not TypeScript.** |
| 5 | Backend: standalone long-lived **Express + JSDoc** orchestrator. |
| 6 | **Postgres.** |
| 7 | **Live Slidev dev server (HMR) while editing; `slidev build` static when published/shared.** Subdomain per deck (`<id>.decks.app.com`) behind ONE wildcard cert; Caddy → Express; Express proxies preview + HMR ws to the deck's localhost port **after auth**. Deck ports never public. |
| 8 | **better-auth `organization` plugin** (Admin/Member + invitations) + per-deck `deck_collaborator` (editor/viewer) + `share_link` (view/edit + optional password, no account). A **deck is the unit of access**. |
| 9 | **One shared chat thread per deck** (schema collaboration-ready); real-time broadcast/presence deferred to v2; **v1 single-active-editor**. |
| 10 | **Role-scoped agent**: Members = content-only; Admins = free-reign. |
| 11 | Themes = **admin-curated scaffold folders**. Create deck = copy scaffold → install → spawn Slidev. |
| 12 | **PPTX export first-class + import (rough)**, reusing `slidev-pptx`. |
| 13 | Model: **Claude tiered + swappable** — Sonnet 4.6 for Member edits, Opus 4.8 for Admin theme work; provider/model configurable per deck/role. |

---

## 3. Tech stack & key packages

**Runtime:** Node ≥ 20, pnpm workspaces, Postgres ≥ 15, one DO droplet (recommend ≥ 4 GB RAM / 2 vCPU to start; each live Slidev/Vite is ~200–400 MB), custom Caddy binary.

**Server (`apps/server`, JSDoc):**
- `express`, `http-proxy` (or `http-proxy-middleware` + manual `upgrade` handling for ws), `cookie`/`cors`.
- `better-auth` + its `organization` and `admin` plugins (Kysely adapter).
- `pg` (single shared `Pool`), `kysely` (used by better-auth adapter; app queries may use raw `pg` or Kysely).
- `deepagents` (Node entrypoint), `@langchain/anthropic` (`ChatAnthropic`), `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`).
- `zod` (tool schemas), `nanoid`/`uuid` (deck ids/subdomains, share tokens), `bcrypt`/`argon2` (share-link passwords).

**Web (`apps/web`, JSDoc):**
- `react`, `react-dom`, `vite`, `@vitejs/plugin-react`.
- `@tanstack/react-query`, a router (React Router or TanStack Router — SPA mode), `better-auth/client`.

**Themes/decks (per scaffold, e.g. mirrors the reference):** `@slidev/cli`, `vue`, `@slidev/theme-default`, `apexcharts`/`vue3-apexcharts`, `@iconify-json/mdi`, `@animxyz/core`, `playwright-chromium` (export).

> JSDoc note: enable `// @ts-check` + a root `jsconfig.json` so editors check JSDoc against bundled `.d.ts`. Type fetcher return shapes in `packages/shared/typedefs.js`; don't fight library generics.

---

## 4. Verified stack facts (with code)

### 4.1 `deepagents` (npm; repo `langchain-ai/deepagentsjs`)
`createDeepAgent({...})` returns a **compiled LangGraph graph** → native `.stream()`, `checkpointer`, `interruptOn`, `AbortSignal`. Use the Node entrypoint.

```js
// apps/server/src/agent/makeAgent.js
import { createDeepAgent } from "deepagents";
import { FilesystemBackend } from "deepagents"; // backend export
import { ChatAnthropic } from "@langchain/anthropic";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getAgentConfig } from "@app/permissions";

/** @param {{deck: Deck, role: 'member'|'admin', checkpointer: PostgresSaver}} args */
export function makeAgent({ deck, role, checkpointer }) {
  const { modelName, tools, permissions, systemPrompt } = getAgentConfig(role, deck);
  const backend = new FilesystemBackend({
    rootDir: deck.fs_path,     // /srv/decks/<id>
    virtualMode: true,         // MANDATORY: blocks .. ~ and absolute escapes
    permissions,               // path-glob read/write allow/deny (see §10)
  });
  return createDeepAgent({
    model: new ChatAnthropic({ model: modelName, temperature: 0 }),
    backend,
    tools,                     // curated custom tools (zod schemas)
    systemPrompt,
    checkpointer,              // persists thread state
    subagents: [],             // no subagents for content editing
  });
}
```

- **`model`** takes a **LangChain chat-model instance**, not a string id.
- **Path jail = `FilesystemBackend({ rootDir, virtualMode: true })`.** Without `virtualMode` there is **no** path security even with `rootDir`. Never use `LocalShellBackend`.
- deepagents also exposes a declarative **path-glob permissions** layer (read/write allow/deny) — used for Member vs Admin scoping.
- **Gotcha (deepagentsjs #131):** a `GraphInterrupt` thrown *inside* a tool can lose its `interrupts` prop. Gate sensitive tools via the framework `interruptOn` config, not by throwing interrupts inside tools.

Docs: docs.langchain.com/oss/javascript/deepagents/{overview,backends,human-in-the-loop} · npmjs.com/package/deepagents

### 4.2 better-auth
`organization` plugin → orgs, members, roles (`owner`/`admin`/`member`, comma-separated multi-role), invitations (48h default). `admin` plugin → create users, set roles, ban, impersonate. Framework-agnostic Express handler; Postgres first-class.

**Use the built-in Kysely adapter** → `better-auth generate` emits a plain **`schema.sql`** (no `.ts`, no ORM codegen) — the least-painful path for a JSDoc repo, and reuses the same `pg` pool as `PostgresSaver`.

```js
// apps/server/src/auth/auth.js
import { betterAuth } from "better-auth";
import { organization, admin } from "better-auth/plugins";
export const auth = betterAuth({
  database: { /* kysely dialect over the shared pg Pool */ },
  emailAndPassword: { enabled: true },
  plugins: [organization(), admin()],
});
// mount: app.all("/api/auth/*", toNodeHandler(auth));  // session middleware reads auth.api.getSession(req)
```

Docs: better-auth.com/docs/plugins/{organization,admin} · /docs/concepts/{database,cli}

### 4.3 LangGraph.js Postgres checkpointer
`@langchain/langgraph-checkpoint-postgres` → `PostgresSaver`. Keep its tables in a separate schema.

```js
const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL, { schema: "langgraph" });
await checkpointer.setup(); // once at boot; creates checkpoints/checkpoint_writes/checkpoint_blobs
// stream a run, keyed by thread:
const stream = await agent.stream(
  { messages: [{ role: "user", content }] },
  { configurable: { thread_id: deck.id }, streamMode: ["messages", "updates"], signal: abortController.signal }
);
```

### 4.4 Slidev
- `slidev <entry> --port <n>` runs multiple instances; bind localhost. Reuse the readiness-poll in the converter's `server.ts`.
- `slidev build` → static `dist/`. `slidev export --format pptx` rasterizes (non-editable) → **prefer the `slidev-pptx` converter** for editable output.
- **HMR behind TLS subdomain (the #1 risk):** inject per-deck Vite config so the *client* connects over wss/443 while the server listens locally:
```js
// injected per deck (vite.config or slidev config)
server: { hmr: { protocol: 'wss', clientPort: 443, path: '/__hmr' } }
```
Express must proxy the ws **upgrade** (copy `Upgrade`/`Connection`, set `X-Forwarded-Proto: https`) to the deck port.

Docs: sli.dev/builtin/cli · sli.dev/guide/{exporting,hosting} · vite.dev/config/server-options (`hmr.clientPort`)

### 4.5 Caddy
Wildcard via **DNS-01 + `caddy-dns/digitalocean`** (build custom binary). Websocket proxying automatic.

```bash
xcaddy build --with github.com/caddy-dns/digitalocean
```
```caddy
# Caddyfile
app.com {
  root * /srv/web/dist
  try_files {path} /index.html        # SPA fallback
  file_server
  reverse_proxy /api/* 127.0.0.1:8080
}
*.decks.app.com {
  tls { dns digitalocean {env.DO_API_TOKEN} }   # one wildcard cert for all decks
  reverse_proxy 127.0.0.1:8080                   # -> Express, which authenticates then proxies to the deck port (incl. ws)
}
```
On-demand TLS is the documented fallback (`tls { on_demand }` + global `on_demand_tls { ask http://127.0.0.1:8080/internal/tls-check }`; the `ask` endpoint must be a fast indexed lookup).

Docs: caddyserver.com/docs/{automatic-https,caddyfile/directives/tls,caddyfile/options} · github.com/caddy-dns

### 4.6 TanStack Query + JSDoc
Ships compiled JS + bundled `.d.ts`; no TS needed. Use Query for REST CRUD; a separate hand-rolled `EventSource` hook for agent SSE; bridge `file_change` SSE → `queryClient.invalidateQueries(['deck', id, 'files'])`. One `QueryClient` at root.

---

## 5. Architecture — request flow

```
                         ┌────────────────────────── Caddy (custom binary, DO DNS) ──────────────────────────┐
 Browser ── https ──▶    │ app.com            → serve web/dist (SPA) + /api/* → Express                       │
                         │ *.decks.app.com    → Express (one wildcard cert)                                   │
                         └───────────────────────────────────┬───────────────────────────────────────────────┘
                                                              ▼
                                       ┌──────────── Express orchestrator (:8080, long-lived) ───────────┐
                                       │ better-auth + session middleware                                 │
                                       │ deck/collaborator/share CRUD (pg)                                │
                                       │ ProcessSupervisor (spawns/tracks per-deck Slidev procs)          │
                                       │ deepagents runtime + SSE transport (graph.stream)                │
                                       │ AUTH-GATED proxy:  resolve subdomain→deck → requireDeckPermission│
                                       │                     → proxy HTTP + HMR ws → 127.0.0.1:<deckPort> │
                                       └───────────────┬──────────────────────────┬──────────────────────┘
                                                       ▼                          ▼
                                   127.0.0.1:<p> Slidev dev server         Postgres (app schema + langgraph schema)
                                   (one per ACTIVE edit session)           /srv/decks/<id> (deck files; FS backend root)
```

**Editing-session sequence:** open deck → Supervisor spawns `npx slidev /srv/decks/<id>/slides.md --port <p>` (localhost) → browser iframe loads `<id>.decks.app.com` → Caddy→Express resolves subdomain→deck, runs `requireDeckPermission(session, deck, 'view'|'edit')`, proxies HTTP + HMR ws to `127.0.0.1:<p>` → user chats → agent edits `slides.md` → Vite HMR repaints iframe in ~1s.

**Published deck:** no process; `slidev build` output served as static files.

---

## 6. Environment & config

`.env` (server):
```
DATABASE_URL=postgres://...
ANTHROPIC_API_KEY=...
DO_API_TOKEN=...              # Caddy DNS-01 + doctl provisioning
APP_DOMAIN=app.com
DECKS_DOMAIN=decks.app.com
DECKS_ROOT=/srv/decks
THEMES_ROOT=/srv/themes
PORT_POOL_START=4000
PORT_POOL_END=4999
MAX_CONCURRENT_DECKS=20
DECK_IDLE_TIMEOUT_MS=900000   # 15 min
SESSION_SECRET=...
```

**DNS:** `A app.com → droplet IP`; `A *.decks.app.com → droplet IP` (wildcard). DO DNS zone managed so Caddy can answer DNS-01 with `DO_API_TOKEN`.

---

## 7. Monorepo structure (pnpm workspaces)

```
/ (pnpm-workspace.yaml, jsconfig.json [// @ts-check], package.json, .env)
├─ apps/
│  ├─ web/                      React SPA (Vite + JSDoc + TanStack Query)
│  │   src/main.jsx             QueryClientProvider, router
│  │   src/api/                 fetch wrappers, queryKeys.js, useAgentStream.js (SSE)
│  │   src/features/auth/       better-auth client, login, org/role gating
│  │   src/features/decks/      list, create-from-theme, collaborators, share-links
│  │   src/features/editor/     EditorPage: <ChatPane/> + <PreviewIframe src=subdomain/>
│  │   src/typedefs.js          @typedef API shapes
│  └─ server/                   Express orchestrator (JSDoc)
│      src/index.js             boot: pg pool, PostgresSaver.setup(), supervisor, http+ws listen
│      src/http/app.js          express app, route mounts, SPA-agnostic (Caddy serves web)
│      src/auth/auth.js         better-auth instance + toNodeHandler mount
│      src/auth/session.js      requireSession, requireOrgRole, requireDeckPermission
│      src/decks/routes.js      deck CRUD; create=copyScaffold+install
│      src/decks/scaffold.js    copy /srv/themes/<key> -> /srv/decks/<id>, warm install
│      src/agent/makeModel.js   role/deck -> ChatAnthropic instance
│      src/agent/makeAgent.js   createDeepAgent wiring (see §4.1)
│      src/agent/tools/         member.js, admin.js (zod tool defs)
│      src/agent/run.js         start/cancel a run; emit SSE events; persist chat_message
│      src/supervisor/index.js  ProcessSupervisor (port pool, registry, idle TO, recovery)
│      src/proxy/deck.js        subdomain->deck resolve, auth, http+ws upgrade proxy
│      src/publish/build.js     slidev build job -> published_build_path
│      src/pptx/export.js       shell slidev-to-pptx; src/pptx/import.js shell pptx-to-slidev
│      src/db/pool.js, migrations/  pg pool + SQL migrations (incl. better-auth schema.sql)
│      src/sse/transport.js     graph.stream -> text/event-stream; AbortController registry
├─ packages/
│  ├─ shared/                   JSDoc typedefs shared web<->server (Deck, Role, AgentEvent…)
│  ├─ permissions/              getAgentConfig(role, deck) — SINGLE source of truth (§10)
│  └─ db-schema/                better-auth schema.sql + app migration SQL files
├─ themes/
│  └─ commercial-profile/       copy of omni_hub reference deck (theme/, slides.md, public/, package.json, setup/)
│      _node_modules_template/  optional pre-warmed install for fast deck creation
└─ vendor/
   └─ slidev-pptx/              vendored converter (built to dist/, invoked as subprocess)
```

---

## 8. Postgres schema (types + indexes)

`org_id` on every tenant-scoped table (one org in v1). Use `uuid` PKs (default `gen_random_uuid()`); `text` for ids that appear in subdomains/tokens, generated via `nanoid`.

```
org(id uuid pk, name text, slug text unique, created_at timestamptz)

-- better-auth managed (Kysely schema.sql): user, session, account, verification
user(id, email unique, name, image, role text /*global admin|user*/, created_at)
member(id, org_id fk, user_id fk, role text /*owner|admin|member*/, created_at, unique(org_id,user_id))
invitation(id, org_id fk, email, role, status, inviter_id fk, expires_at, created_at)

deck(
  id text pk /*nanoid; also the subdomain label*/, org_id fk, owner_user_id fk,
  title text, slug text, theme_id fk, status text /*draft|active|published|archived*/,
  fs_path text /*/srv/decks/<id>*/, subdomain text unique,
  active_editor_user_id uuid null /*v1 single-editor lock*/,
  published_build_path text null, created_at, updated_at,
  index(org_id), unique(subdomain)
)

deck_collaborator(id, org_id fk, deck_id fk, user_id fk, role text /*editor|viewer*/,
  created_at, unique(deck_id,user_id), index(user_id))

share_link(id, org_id fk, deck_id fk, token text unique /*high-entropy*/,
  permission text /*view|edit*/, password_hash text null, expires_at null,
  created_by fk, created_at, revoked_at null, index(token))

theme(id, org_id fk, key text unique, name, description, source_path text /*/srv/themes/<key>*/,
  min_role text, is_active bool, created_at)

chat_thread(id, org_id fk, deck_id fk unique, langgraph_thread_id text, created_at)

chat_message(id, org_id fk, thread_id fk, role text /*user|assistant|tool|system*/,
  content jsonb /*text + tool calls/results + file_change events*/,
  author_user_id uuid null /*null=agent*/, created_at, index(thread_id, created_at))

agent_run(id, org_id fk, deck_id fk, thread_id fk, status text /*running|done|canceled|error*/,
  model text, role_scope text, started_at, ended_at null, error text null)

deck_process(deck_id fk pk, pid int, port int, status text, last_activity_at, started_at) -- optional; else in-memory

-- Agent checkpoints: NOT hand-modeled; PostgresSaver.setup() owns schema "langgraph"
--   (checkpoints, checkpoint_writes, checkpoint_blobs). Linked via chat_thread.langgraph_thread_id.
```

---

## 9. Auth, sessions & permission gates

- Mount `auth` at `/api/auth/*`. `session.js` exposes:
  - `requireSession(req)` → user/session or 401.
  - `requireOrgRole(req, ['admin'])` → 403 if not.
  - `requireDeckPermission(session, deck, need)` → true if owner, or `deck_collaborator` with sufficient role, or a valid (unexpired, unrevoked, password-satisfied) `share_link`. **Called by the proxy before any byte reaches a deck process.**
- Member vs Admin **agent** selection derives from the org `member.role` (owner/admin → free-reign agent; member → content-only agent).

---

## 10. Agent tool sets + enforcement (defense-in-depth)

**Layer 1 (both roles):** `FilesystemBackend({ rootDir: deck.fs_path, virtualMode: true })`. Assert `virtualMode===true` at startup; test that a Member agent cannot read `/etc/passwd`.

**Layer 2:** deepagents path-glob permissions + curated tools, per role. `packages/permissions/getAgentConfig`:

```js
// packages/permissions/index.js
export function getAgentConfig(role, deck) {
  if (role === 'admin') return {
    modelName: 'claude-opus-4-8',
    systemPrompt: ADMIN_PROMPT,
    permissions: { write: ['**'], read: ['**'] },           // jailed by virtualMode to deck dir
    tools: [addAsset, listLayouts, listComponents, applyFrontmatter, screenshotSlide,
            addDependency, restartSlidev, createComponent, createLayout],
  };
  return {                                                    // member: content-only
    modelName: 'claude-sonnet-4-6',
    systemPrompt: MEMBER_PROMPT,
    permissions: {
      read: ['**'],                                           // may read theme to use existing layouts
      write: ['slides.md', 'public/**', 'slides/*.md'],       // content only
      deny:  ['theme/**', 'package.json', 'package-lock.json', 'setup/**',
              'vite.config.*', '**/*.vue', '.*', '**/.*'],
    },
    tools: [addAsset, listLayouts, listComponents, applyFrontmatter, screenshotSlide],
  };
}
```

- **Member tools:** `addAsset` (write into `public/`), `listLayouts`/`listComponents` (read-only introspection of `theme/` so the agent uses existing names), `applyFrontmatter` (per-slide `layout:`), `screenshotSlide` (preview check via converter extractor). **No** shell, npm, or `theme/` write; subagents off.
- **Admin tools (additional):** `addDependency` (controlled `npm install <pkg>` — fixed argv, package allow/deny list, cwd = deck dir, **not** raw shell; gate via `interruptOn`), `restartSlidev` (ask supervisor to bounce after dep change), `createComponent`/`createLayout` scaffolding. **No raw shell even for Admin.**

---

## 11. Process supervisor (`apps/server/src/supervisor`)

Single long-lived supervisor in Express; in-memory `Map<deckId, {proc, port, lastActivityAt, status}>` (optionally mirror to `deck_process`).

- **Spawn (on first edit session):** allocate a free port from `[PORT_POOL_START, PORT_POOL_END]`; `spawn('npx', ['slidev', slidesPath, '--port', String(port)], { cwd: deckDir, shell: false })`; reuse the converter `server.ts` readiness poll (`GET 127.0.0.1:port` until <500). Ensure the deck's vite/slidev config carries `server.hmr.clientPort:443, protocol:'wss', path:'/__hmr'`.
- **Track:** bump `lastActivityAt` on every proxied request/ws frame.
- **Idle timeout:** sweep every 60s; SIGTERM processes idle > `DECK_IDLE_TIMEOUT_MS`; free port; status→`stopped`; next edit re-spawns transparently.
- **Crash recovery:** `proc.on('exit')` non-clean → mark `crashed`; restart with exponential backoff + max retries; SSE banner on repeated failure.
- **Caps:** refuse spawns past `MAX_CONCURRENT_DECKS` (“server busy”); LRU-evict least-recently-used idle deck at cap; memory watchdog.

**Proxy (`proxy/deck.js`) = the security boundary:**
```js
// HTTP
app.use(async (req, res, next) => {
  const deck = await resolveDeckBySubdomain(req.hostname);     // <id>.decks.app.com
  if (!deck) return next();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!(await requireDeckPermission(session, deck, methodToNeed(req)))) return res.sendStatus(403);
  supervisor.touch(deck.id);
  proxy.web(req, res, { target: `http://127.0.0.1:${supervisor.portFor(deck.id)}` });
});
// WS upgrade (HMR)
server.on('upgrade', async (req, socket, head) => {
  const deck = await resolveDeckBySubdomain(req.headers.host);
  const session = await auth.api.getSession({ headers: req.headers });
  if (!deck || !(await requireDeckPermission(session, deck, 'view'))) return socket.destroy();
  proxy.ws(req, socket, head, { target: `http://127.0.0.1:${supervisor.portFor(deck.id)}` });
});
```
**Deck ports bind 127.0.0.1 only; never exposed by Caddy.**

---

## 12. SSE agent transport (`apps/server/src/sse`, `agent/run.js`)

- `POST /api/decks/:id/messages` → start a run: load/create `chat_thread`, persist the user `chat_message`, create `agent_run(status=running)`, register an `AbortController`.
- Response is `text/event-stream`; pipe `agent.stream(..., { configurable:{thread_id}, streamMode:['messages','updates'], signal })`. Map LangGraph chunks to events: `token`, `tool_call`, `tool_result`, `file_change` (emit when a write tool touches a file), `done`, `error`.
- `POST /api/decks/:id/cancel` → `abortController.abort()`; mark run `canceled`.
- On `done`: persist assistant/tool `chat_message`s (transcript also recoverable from the checkpointer by `langgraph_thread_id`).
- Web `useAgentStream` consumes events; on `file_change` → `queryClient.invalidateQueries(['deck', id, 'files'])` and trust Vite HMR to repaint the iframe.

---

## 13. Frontend (`apps/web`)

- **Editor page:** split view — left `ChatPane` (message list from `chat_message` + `useAgentStream`), right `PreviewIframe` pointing at `https://<deck.subdomain>` (auth-gated by the proxy via cookies).
- **Decks:** list (TanStack Query), “New deck” → pick a `theme` → `POST /api/decks` (server copies scaffold, installs, marks `active`), then navigate to editor.
- **Collaborators/Share:** manage `deck_collaborator` (editor/viewer) and `share_link` (view/edit, optional password, copy URL, revoke).
- **Auth:** better-auth client; login; org/role gating hides Admin-only affordances.
- Type API responses in `typedefs.js`; cast Query results; SSE handled outside Query.

---

## 14. PPTX integration (`apps/server/src/pptx`)

- **Export (first-class):** `export.js` shells the vendored `slidev-to-pptx` against `deck.fs_path` as a **bounded background job** (Chromium is RAM-hungry — queue, don’t run concurrently with many live decks). Default `screenshot` mode (matches heavy custom-component decks); expose `editable`/`hybrid`; run the converter’s `--verify`. Result downloadable; surface progress via job status.
- **Import (rough):** `import.js` shells `pptx-to-slidev` to produce a scaffold deck dir, registers it as a `deck` (flagged “rough”), then the agent refines it. The converter contract (modes, slide range, ports, out dir) is defined by `slidev-pptx/src/.../cli.ts`.

---

## 15. Theme / scaffold system

- A theme = a folder under `/srv/themes/<key>` shaped like the reference deck: `theme/` (Vue `layouts/`, `components/`, `composables/`, `styles/` tokens, local fonts in `public/fonts/`), a starter `slides.md` (`theme: ./theme`), `package.json`, `setup/`.
- **First scaffold** = copy of `/home/ross/Documents/developer/omni_hub/slidev-commercial-profile/app` → `themes/commercial-profile`.
- **Deck creation:** copy scaffold → `/srv/decks/<id>`; install deps. **Mitigate slow installs** with a pre-warmed `_node_modules_template_` (or shared pnpm store / hoisted install + symlink); lazy-install on first spawn; cap concurrent installs.
- Admins curate themes (add/edit scaffold folders; `theme` table registers `key`, `source_path`, `min_role`, `is_active`).

---

## 16. Phased build plan (each phase shippable)

- **Phase 0 — Infra + scaffold.** `git init`; pnpm monorepo; Postgres; DO droplet via `doctl`; DNS (`A app.com`, `A *.decks.app.com`); build custom Caddy (DO DNS module); issue `*.decks.app.com` wildcard; serve hello-world from Express behind Caddy; `pg` pool + migration runner; `npx playwright install --with-deps chromium`; `PostgresSaver.setup()`. **Exit:** `https://test.decks.app.com` reaches Express over valid TLS; DB reachable.
- **Phase 1 — CORE LOOP SPIKE (riskiest, first).** Hardcode one theme + one user. Create deck = copy `themes/commercial-profile` → `/srv/decks/<id>` → install → spawn Slidev on a localhost port. Express proxies the subdomain **including HMR ws** (validate `clientPort:443`/`wss` + upgrade). Wire `makeAgent` (Sonnet + `FilesystemBackend{virtualMode:true}` + member tools + `PostgresSaver`) + the SSE endpoint. **Acceptance:** “make slide 2 title bigger” → `slides.md` changes on disk → iframe HMR repaints ~1s, no reload; HMR ws is `wss://<id>.decks.app.com/__hmr` (verify in DevTools). *If HMR-over-proxy can’t be tamed, the live-preview premise needs rethinking — that’s why it’s first.*
- **Phase 2 — Auth/orgs/roles/ownership.** better-auth (Kysely `schema.sql`) + `organization`/`admin`; session middleware gates the proxy; deck CRUD; `deck_collaborator`; Member-vs-Admin model selection in the agent factory.
- **Phase 3 — Supervisor hardening.** Promote Phase-1 spawning to full `ProcessSupervisor` (pool, idle TO, crash recovery, caps, LRU, health checks).
- **Phase 4 — Role-scoped agents + jail enforcement.** Finalize Member/Admin tool sets + permissions; Admin gets `addDependency`/`restartSlidev` + Opus; verify Member cannot touch `theme/**`, `package.json`, or npm.
- **Phase 5 — Publish/share.** `slidev build` → static at published subdomain (no process); `share_link` (view|edit, hashed password, revocable token); external edit links → constrained session.
- **Phase 6 — PPTX.** Vendor `slidev-pptx`; export job (screenshot default; editable/hybrid exposed) → download; import → scaffold deck (flagged rough).
- **Phase 7 — Collaboration completeness + polish.** Enforce single active editor (`active_editor_user_id` advisory lock; second user read-only); cancellable runs; error surfaces; idle/quotas. Real-time presence/broadcast deferred to v2 (schema ready).

---

## 17. Top risks & mitigations

1. **HMR ws over TLS subdomain through Express (highest).** Phase-1 spike; `clientPort:443`+`wss`+fixed path; explicit `upgrade` handling. Fallback: dedicated HMR ws port, or polling reload.
2. **`npm install` per deck slow/disk-heavy.** Pre-warmed `node_modules` template / shared pnpm store / hoisted+symlink; lazy install; cap concurrency.
3. **Single VPS resource exhaustion** (each Vite ~hundreds of MB). `MAX_CONCURRENT_DECKS`, idle-timeout, LRU, memory watchdog. Main v1 ceiling; v2 = containers.
4. **`virtualMode` opt-in — forgetting = full host FS.** Construct backends only in `getAgentConfig`; startup assert; `/etc/passwd` test.
5. **deepagentsjs `GraphInterrupt`-from-tool bug (#131).** Gate sensitive tools via framework `interruptOn`; test resume.
6. **PPTX fidelity vs editability.** Default screenshot mode; expose mode; use converter `--verify`.
7. **Playwright/Chromium on headless VPS.** Install `--with-deps` in Phase 0; bounded export queue.
8. **better-auth types are TS.** Kysely + `schema.sql` keeps schema out of TS; consume from JS with `@ts-check`.
9. **Single wildcard cert renewal = SPOF.** Monitor Caddy DNS-01 renewal; scope/rotate DO token; on-demand TLS fallback.
10. **Subdomain enumeration.** Mandatory proxy auth before proxying; non-guessable deck ids (nanoid); high-entropy revocable share tokens.
11. **v1 concurrent edits.** `active_editor_user_id` advisory lock; second editor read-only until released.
12. **Preview staleness in UI.** `file_change` SSE → invalidate `['deck',id,'files']` + trust HMR; reconcile transcript from `chat_message` + checkpointer on reconnect.

---

## 18. Critical reference files (reuse, don’t rebuild)

- `/home/ross/Documents/developer/slidev-pptx/src/slidev-to-pptx/server.ts` — spawn + readiness-poll pattern → lift into `ProcessSupervisor`.
- `/home/ross/Documents/developer/slidev-pptx/src/slidev-to-pptx/cli.ts` — export service contract (modes, slide range, ports) for `server/pptx/export.js`.
- `/home/ross/Documents/developer/slidev-pptx/src/pptx-to-slidev/cli.ts` — import contract.
- `/home/ross/Documents/developer/omni_hub/slidev-commercial-profile/app/slides.md` — content/theme contract (`theme: ./theme`, per-slide `layout:`, component usage) — what Member agents may edit.
- `/home/ross/Documents/developer/omni_hub/slidev-commercial-profile/app/package.json` — scaffold dependency/script baseline.
- `/home/ross/Documents/developer/omni_hub/slidev-commercial-profile/app/theme/` (`index.ts`, `layouts/`, `components/`, `composables/`, `styles/`) — Admin-only boundary the jail/permissions protect; basis of the first scaffold.

---

## 19. Verification (end-to-end)

- **Phase 0:** `curl -I https://test.decks.app.com` → valid TLS, reaches Express; `psql` connects; `playwright` chromium present.
- **Phase 1 (core loop):** open a deck → live preview loads via subdomain → chat “make slide 2 title bigger” → `slides.md` changed on disk AND iframe hot-reloads ~1s without full refresh; confirm `wss://<id>.decks.app.com/__hmr` in DevTools.
- **Security:** as Member, ask the agent to edit `theme/index.ts` / `package.json` / read `/etc/passwd` → all refused/blocked. As Admin, theme edit succeeds; `addDependency` runs only inside the deck dir.
- **Auth/permissions:** user without `deck_collaborator` or valid `share_link` → 403 at the proxy before the deck process is reached; view-only share link cannot trigger agent edits.
- **Publish/share:** publish → static build at subdomain with no running process; password share link prompts; revoked token 404s.
- **PPTX:** export → `.pptx` opens in PowerPoint (editable=real text/shapes; screenshot=image fidelity); import → rough scaffold deck the agent refines.
- **Supervisor:** idle deck past timeout → reaped + port freed; re-open → re-spawns; kill a deck process → auto-restarts with backoff.
- **Persistence:** restart Express → reopening a deck restores transcript (from `chat_message` + `PostgresSaver` checkpoint by `langgraph_thread_id`).

---

## 20. Out of scope (v1) / v2 candidates

- **v1 out of scope:** marimo/data dashboards; org-management UI (multi-tenant); real-time collaboration broadcast/presence; native `slidev export` (use the converter); Docker isolation.
- **v2 candidates:** Docker/container-per-deck (hard resource limits, run untrusted code); real-time multi-writer collaboration (WebSocket broadcast + presence + per-deck agent-run lock/queue); BYO provider/keys + multi-tenant billing; theme-authoring UI; improved pptx→slidev import fidelity; horizontal scale (multiple droplets, deck affinity/routing).

> Note: to use cloud agents (e.g. Ultraplan) later, this must live in a git repo — `git init` is the first Phase-0 step.
