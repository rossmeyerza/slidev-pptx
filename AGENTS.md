# Agent Rules

## Product Direction

- The product: employees chat with an LLM that generates and edits **static HTML slide decks**, previewed live in the web app, collaborative internally, and shareable with clients via tokenized links.
- Decks are folders of plain files (per-slide HTML + `deck.json` + theme CSS) served statically in a fixed 1280x720 slide runtime — the promoted `themes/custom-html` format. No per-deck dev servers, no build step.
- PPTX export is a flattened, pixel-perfect artifact (Playwright screenshots via pptxgenjs). **Editable PPTX is explicitly a non-goal** — do not propose or reintroduce DOM-to-shapes export paths.
- Slidev is retired as the deck runtime. Do not propose Slidev-based preview/authoring solutions; remaining Slidev pieces (draft/published static builds, scaffolds) are transitional until the HTML runtime migration completes.
- Collaboration in v1 = deck collaborators + edit locks + share links (optional password, visitor identity capture). Real-time CRDT co-editing is out of scope for v1.
- Admins manage users, templates, model/provider settings, and deck-level project tools.

## Stack Decisions

- Use React for the web UI.
- Use TypeScript on the server.
- npm is the package manager (no pnpm).
- All deck edits run through the deepagents runtime (path-jailed filesystem backend); the LLM edits deck files directly.
- Keep server source organized by domain under `apps/server/src`:
  - `agent`
  - `api`
  - `auth`
  - `core`
  - `db`
  - `decks`
  - `export`
  - `preview`

## UI Rules

- Use Halfmoon components and utilities first.
- Do not create custom CSS when a Halfmoon component, layout class, helper, or utility can do the job.
- Ask Ross before adding new custom CSS.
- Existing custom CSS should be treated as technical debt unless it handles app-specific fixed-format layout that Halfmoon does not provide, such as deck preview frames, workbench split panes, scrollable chat streams, or dashboard grids.
- Sidebar navigation must use Halfmoon sidebar/offcanvas patterns: `.sidebar`, `.offcanvas-start`, `.sidebar-brand`, `.sidebar-nav`, `.sidebar-header`, and `.sidebar-divider`. The sidebar is a collapsible drawer on all screen sizes, toggled by a hamburger button.
- Use Halfmoon/Bootstrap toast markup for transient action feedback such as invites, settings saves, and recoverable workflow errors.
- Bootstrap JS may be imported only as the behavior layer for Halfmoon components that require it, such as offcanvas drawers, dropdowns, and dismissible toasts.
- The approved custom CSS exception for the sidebar is `.workspace-sidebar { --bs-offcanvas-width: 18rem; }`.

## Local Verification

- Run focused builds and smoke tests after meaningful changes.
- Common commands:
  - `npm run build:server`
  - `npm run build:web`
  - `bash scripts/smoke-app.sh`
  - `npm run smoke:exporter`
  - `npm run smoke:security`
  - `npm run smoke:auth-bridge`
  - `npm run smoke:auth-org`
- `npm run smoke:deepagents` is opt-in and skips unless `RUN_DEEPAGENTS_SMOKE=true`.

## Operational Notes

- SMTP is configured in `.env.local` for `mail.21436587.xyz:465` with implicit TLS.
- If SMTP delivery fails in development, auth returns a one-time dev link for existing users only. This is not public sign-up.
- Before production exposure, dev-link fallback should be gated behind an explicit environment flag.
- The better-auth migration is parked: compatibility magic-link auth (`auth/auth.ts`) is the active path; `auth/betterAuth.ts` stays mounted for Postgres deployments but should not be extended until the migration is deliberately resumed.

## Plan

See `docs/product-direction.md` for the current-state architecture and the phased plan (runtime promotion, agent wiring, export retarget).

When editing deck content, follow `docs/deck-authoring.md`: edit `deck.json`, `slides/*.html`, `theme.css`, and `assets/` only — never the runtime shell files (`index.html`, `runtime.js`, `runtime.css`) or platform bookkeeping (`slides.md`, `package.json`, `meta.json`).
