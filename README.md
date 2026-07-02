# slidev-pptx

Convert between Slidev decks and PowerPoint PPTX files.

This package provides two CLIs:

- `slidev-to-pptx`: render a Slidev deck to a PowerPoint file
- `pptx-to-slidev`: extract a PowerPoint file to a Slidev project

The Slidev-to-PPTX default conversion mode is optimized for visual fidelity: each Slidev page is rendered in Chromium and embedded as one full-bleed image on the matching PPTX slide. This preserves the final static layout, including custom Vue components, SVGs, CSS, local fonts, and images. Slide transitions are intentionally not reproduced.

## Install

```sh
npm install
npm run build
```

## V1 app

This repo now includes a v1 web app around the converter:

- static UI in `apps/web`
- Node HTTP server in `apps/server`, with domain code under
  `src/{agent,api,auth,core,db,decks,export,preview}`
- commercial-profile scaffold in `themes/commercial-profile`
- smaller smoke scaffold in `themes/basic`
- local JSON/file state under `.data`

For current implementation rules, see `AGENTS.md`. For the current build status,
see `docs/status-2026-06-23.md`.

Run it locally:

```sh
npm install
npm run build
npm run build:server
npm run db:migrate # optional; no-op unless DATABASE_URL is set
npm run start:server
```

Open `http://127.0.0.1:4321`.

Useful environment variables:

```sh
PORT=4545
HOST=127.0.0.1
SLIDEV_AGENT_DATA_DIR=.data
SLIDEV_AGENT_WEB_DIR=apps/web
DEFAULT_SCAFFOLD=commercial-profile
DATABASE_URL=
DATABASE_SSL=false
LANGGRAPH_SCHEMA=langgraph
PUBLIC_BASE_URL=http://127.0.0.1:4545
APP_DOMAIN=app.example.com
DECKS_DOMAIN=decks.example.com
LOG_LEVEL=info
AUTH_BYPASS=false
AUTH_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
AUTH_BOOTSTRAP_ADMIN_NAME="Admin"
AUTH_ORG_ID=default-org
AUTH_ORG_NAME="Slidev Agent"
AUTH_ORG_SLUG=default
AUTH_SESSION_DAYS=14
AUTH_TOKEN_MINUTES=30
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey-or-user
SMTP_PASS=secret
SMTP_FROM="Slidev Agent <no-reply@example.com>"
PORT_POOL_START=5500
PORT_POOL_END=5599
MAX_CONCURRENT_DECKS=8
DECK_IDLE_TIMEOUT_MS=1200000
DECK_CRASH_RETRY_LIMIT=2
DECK_CRASH_RETRY_DELAY_MS=1000
EXPORT_CONCURRENCY=1
EXPORT_TIMEOUT_MS=180000
IMPORT_TIMEOUT_MS=60000
AGENT_BASE_URL=http://127.0.0.1:3033/v1
AGENT_API_KEY=
AGENT_MODEL=
MEMBER_AGENT_MODEL=
ADMIN_AGENT_MODEL=
AGENT_TIMEOUT_MS=120000
```

The v1 server lists scaffold templates from `themes/` and supports deck creation
from a selected scaffold, including `themes/commercial-profile`. It also supports draft previews at
`/draft/:id`, direct localhost Slidev dev-server workbench previews, published
previews at `/published/:id`, React client share links at `/client/:token`, model-backed
instruction edits, markdown/PPTX export jobs, and rough PPTX imports. PPTX
export/import uses the existing built converters, so run `npm run build` first.
PPTX jobs are queued with `EXPORT_CONCURRENCY` to avoid launching multiple
Chromium-heavy exports at once. Screenshot-mode PPTX exports run the built
verifier before being marked succeeded. Queued or running export jobs found at
server startup are marked failed because v1 export workers are process-local;
users can retry from the deck. PPTX import subprocesses are bounded by
`IMPORT_TIMEOUT_MS`.

The `themes/custom-html` scaffold is a trial non-Slidev runtime. It creates
ordinary deck workspace files (`index.html`, `style.css`, and `deck.js`) and
serves them through the authenticated `/runtime/:deckId/#/1` route. That path has
no build step, no Vite server, and no Slidev process; it is intended to test a
file-based deck surface before migrating agent editing away from `slides.md`.

Previews are static: the authenticated `/api/decks/:id/live` endpoint schedules
a background draft build and returns the preview URL for the workbench iframe
(`/runtime/:deckId/#/1` for custom-html decks, `/draft/:deckId/#/1` otherwise).
There are no per-deck dev servers; draft, published, share, and export flows all
use static builds (or the file-based custom-html runtime) served by the app.
The former per-deck Slidev dev-server supervisor and `/live/:id` proxy were
removed as part of the move to the static HTML deck runtime.

When `DECKS_DOMAIN` is set, previews return deck-host URLs such as
`https://<deck-id>.decks.example.com/#/1`. Caddy should terminate the wildcard
TLS certificate and reverse proxy `*.DECKS_DOMAIN` to the server; Express
authenticates the cookie, resolves the deck id from the hostname, and serves the
published build when available, otherwise the draft static build. See
`deploy/Caddyfile.example` for the expected reverse proxy shape. The
unauthenticated `/internal/tls-check?domain=<deck-host>` endpoint returns 200
only for configured deck-domain hosts backed by an existing deck, which supports
Caddy's on-demand TLS `ask` fallback.
Set `LOG_LEVEL=debug` while running `npm run dev:server` or nodemon directly to
see build timing, export queue transitions, and per-request HTTP logs.

Admins can curate scaffold templates from the Admin screen without editing
environment variables: display name, description, active status, minimum role,
and default scaffold are stored in `SLIDEV_AGENT_DATA_DIR/settings.json`.
Employees only see active employee-level templates when creating decks.
The deck dashboard is role-aware: admins see workspace operations metrics
covering decks, client links, locks/exports, and template availability, while
employees see a focused summary of their visible decks and active work.

Admins also get deck-local project tools on the deck detail screen. These create
Vue components under `theme/components`, create custom layouts under
`theme/layouts`, update deck `package.json` dependencies, and trigger a draft
preview rebuild. These tools are explicit admin-only endpoints; employee
and client edit flows remain content-scoped to deck instructions.

Admins can also override agent model settings for a single deck from the same
deck detail area. Per-deck `baseUrl`, employee model, admin model, and timeout
settings are stored in deck metadata and take precedence over global Admin
settings when that deck runs an agent instruction.

Agent edits are recorded as runs. The workbench receives a run id over the SSE
stream, can cancel an in-flight run, and stores run status in Postgres when
available or local JSON fallback state during development. All deck edits run
through deepagents, a path-jailed filesystem runtime using
`FilesystemBackend({ virtualMode: true })` and role-scoped filesystem
permissions. Deepagents uses the configured OpenAI-compatible model provider
underneath, but edits files through tools instead of using the old plain
text-patch path. The runtime uses the v3 stream projection when
available and forwards message tokens, tool-call/tool-result events, and file
activity over the same deck message SSE stream.

Share links can be created with `view` or `edit` permission. The product-facing
URL is `/client/:token`, a React client surface that handles optional share
passwords, visitor identity capture, view-only preview, and edit-request
workbench. The Slidev iframe itself is served from `/share/:token/deck/#/1`, and
the older `/share/:token` gate/workbench pages remain available for
compatibility. Edit-capable anonymous links require the visitor to enter a
name/email first; the visitor identity is persisted in Postgres when available
or in local JSON fallback state during development.

Internal deck collaborators are managed from the deck detail screen. Editors can
add existing teammates by email, switch them between viewer/editor, and remove
access. The same deck-level roles gate preview, workbench locks, agent edits,
publishing, exports, and share management.

When `DATABASE_URL` is set, startup and `npm run db:migrate` apply SQL migrations
from `packages/db-schema`. Deck metadata is written to Postgres while deck working
files remain on disk under `SLIDEV_AGENT_DATA_DIR/decks`. Share links are also
written to Postgres when available. Deck owners and collaborators gate deck APIs,
draft/published preview routes, exports, and deck-domain requests. In Postgres mode,
decks are also bound to the configured app org row derived from `AUTH_ORG_NAME`
and `AUTH_ORG_SLUG`; deck access denies records outside that app org even for
admins. Chat history is
stored in `chat_thread`/`chat_message` when Postgres is available, with a local
JSON fallback. LangGraph checkpoint tables are set up through
`@langchain/langgraph-checkpoint-postgres` in `LANGGRAPH_SCHEMA`, defaulting to
`langgraph`. Without
`DATABASE_URL`, the local JSON metadata fallback remains active for development
and smoke tests.

Authentication uses one-time email links. With `DATABASE_URL` configured, the
current `/api/auth/*` compatibility endpoints store users, invite tokens, and
sessions in Postgres using better-auth's `"user"`/`"session"` tables plus app
extension tables. They also sync each user into the configured single
better-auth `organization`/`member` record (`AUTH_ORG_*`) so organization-aware
better-auth APIs share the same admin/employee boundary. Without Postgres, the
local JSON fallback remains active.
For local development only, set `AUTH_BYPASS=true` to skip login entirely and
serve every request as an active admin user. Do not enable this for shared or
production environments.
Without SMTP configured, the API returns dev links in the JSON response so local
setup can continue. Admins can invite employees or other admins from the app
sidebar, change user roles/statuses, and disabling a user revokes active
sessions while preserving at least one active admin.

The committed Postgres migrations now include the better-auth magic-link,
organization, and admin schema that will replace the compatibility auth service.
The better-auth handler is mounted at `/api/better-auth/*` when `DATABASE_URL` is
configured. Compatibility login also issues `better-auth.session_token`, and the
deck APIs accept either that signed cookie or the legacy `slidev_session` cookie;
this lets the frontend move onto better-auth client APIs incrementally. The React
app now includes a better-auth client wrapper and uses better-auth magic-link
requests when both better-auth and SMTP are available; otherwise it falls back to
the compatibility endpoint so local dev links still work without SMTP.
Regenerate the committed schema with `npm run auth:schema` after changing
better-auth plugins or auth schema options.

## Slidev to PPTX

```sh
npm run slidev-to-pptx -- /path/to/slides.md output.pptx
```

For the reference deck:

```sh
npm run slidev-to-pptx -- \
  /home/ross/Documents/developer/omni_hub/slidev-commercial-profile/app/slides.md \
  output.pptx \
  --timeout 90000
```

By default this uses:

- `--mode screenshot`
- `--scale 2`, producing 1920x1080 captures for a 16:9 Slidev viewport
- full-slide placement at `10 x 5.625` inches in PowerPoint

Useful options:

```sh
npm run slidev-to-pptx -- slides.md output.pptx --slides 1-5
npm run slidev-to-pptx -- slides.md output.pptx --scale 3
npm run slidev-to-pptx -- slides.md output.pptx --mode editable
npm run slidev-to-pptx -- slides.md output.pptx --mode hybrid
```

`--mode editable` keeps the older DOM-to-PPTX extraction path. It is more editable, but it is not the pixel-perfect path for complex Slidev decks.

## PPTX to Slidev

```sh
npm run pptx-to-slidev -- input.pptx --out ./input-slidev
```

If `--out` is omitted, the converter writes a Slidev project next to the input file using the PPTX basename plus `-slidev`.

The generated project contains:

- `slides.md`
- extracted media assets
- a minimal Slidev package scaffold

## Verify

Run the verifier after generating a screenshot-mode PPTX:

```sh
npm run verify -- output.pptx --slides 29 --scale 2
```

The verifier checks:

- expected slide count
- one screenshot image per slide
- expected screenshot dimensions
- full-bleed PPTX placement at `x=0`, `y=0`
- full-slide size of `9144000 x 5143500` EMUs

The packaged bin wrappers provide the same commands:

```sh
bin/slidev-to-pptx.js slides.md output.pptx
bin/slidev-to-pptx-verify.js output.pptx --slides 29 --scale 2
bin/pptx-to-slidev.js input.pptx --out ./input-slidev
```
