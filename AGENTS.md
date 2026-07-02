# Agent Rules

## Product Direction

- Build a v1 internal deck platform around Slidev.
- Internal employees create decks from curated scaffolds and export PPTX.
- Admins manage users, templates, model/provider settings, live previews, and deck-level project tools.
- Client sharing is supported through share links with optional password and visitor identity capture.

## Stack Decisions

- Use React for the web UI.
- Use TypeScript on the server. The original plan mentioned JavaScript with JSDoc, but the server now has enough auth, deck, share, export, and agent contracts that TypeScript is the safer default.
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
- Existing custom CSS should be treated as technical debt unless it handles app-specific fixed-format layout that Halfmoon does not provide, such as Slidev preview frames, workbench split panes, scrollable chat streams, or dashboard grids.
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
  - `npm run smoke:supervisor`
- `npm run smoke:deepagents` is opt-in and skips unless `RUN_DEEPAGENTS_SMOKE=true`.

## Operational Notes

- SMTP is configured in `.env.local` for `mail.21436587.xyz:465` with implicit TLS.
- If SMTP delivery fails in development, auth returns a one-time dev link for existing users only. This is not public sign-up.
- Before production exposure, dev-link fallback should be gated behind an explicit environment flag.
