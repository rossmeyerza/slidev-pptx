# Product Direction — LLM-Authored HTML Deck Platform

Ratified 2026-07-02. This replaces the original build plan
(`interview-me-relentlessly-about-humming-wigderson.md`, removed), which
described a Slidev-centric platform that the codebase had already drifted away
from.

## The product

Employees open a deck and chat with an LLM that generates and edits static HTML
slides, rendered live in the workbench. Decks support internal collaborators
and edit locks, and are shared with clients via tokenized links (optional
password, visitor identity capture). PPTX/PDF export is a flattened,
pixel-perfect download — a feature, not the core product.

## Decisions and non-goals

- **Deck substrate: static HTML deck folders.** Per-slide HTML files +
  `deck.json` manifest + theme CSS, served statically inside a fixed 1280x720
  slide runtime (the promoted `themes/custom-html` format). The LLM edits these
  files directly through the deepagents runtime.
- **Slidev is retired as the runtime.** With the LLM as the author, Slidev's
  human-authoring ergonomics stopped paying for its operational cost (a Vite
  dev server per deck, preview supervision, build pipeline). The per-deck
  dev-server supervisor, `/live` proxy, and HMR upgrade path were removed.
- **Editable PPTX is a non-goal.** High-fidelity HTML-to-editable-PPTX is not
  reliably solvable (2026 landscape review: Slidev exports images per slide by
  design; Marp's editable mode is LibreOffice PDF-import and lossy; Anthropic's
  pptx skill removed its HTML-to-shapes helper). We ship pixel-perfect
  view-only PPTX via Playwright screenshots + pptxgenjs, with a verifier.
- **Collaboration v1** = collaborators, edit locks, share links. Real-time CRDT
  co-editing is deliberately out of scope.
- **Auth**: compatibility magic-link auth is the active path; the better-auth
  migration is parked, mounted only for Postgres deployments.

## As-built architecture (kept)

- `apps/server` — Express/TS by domain: `agent` (deepagents, path-jailed
  filesystem, SSE streaming), `api`, `auth`, `core`, `db` (Postgres optional,
  JSON fallback), `decks` (CRUD, locks, collaborators, shares, settings),
  `export` (queued HTML-runtime screenshot jobs).
- `apps/web` — React 19 + TanStack Query + Halfmoon; dashboard, deck detail,
  workbench (preview iframe + chat), templates, admin, `/client/:token` share
  surface.
- `src/slidev-to-pptx` / `src/pptx-to-slidev` — the converter core.
  Screenshot mode only (Playwright → pptxgenjs full-bleed + EMU verifier).
- `scripts/smoke-*.sh` — app, HTML exporter, exporter reconciliation,
  security, auth-bridge, and auth-org; deepagents/postgres smokes are opt-in.

## Phased plan

1. **Consolidation (done 2026-07-02).** Checkpoint commit; removed dead vanilla
   frontend, orphaned packages, pnpm config, preview supervisor + `/live`
   proxy, editable/hybrid export modes; docs rewritten to this direction.
2. **Deck runtime promotion (done 2026-07-03, UI parity 2026-07-11).** The
   custom-html format is first-class: `deck.json` manifest, per-slide HTML
   files, branded scaffolds, and a written authoring convention
   (`docs/deck-authoring.md`). The runtime shell ships a full presentation UI
   implemented in vanilla JS (icon nav bar, thumbnail
   overview, goto, click/build steps, slide transitions, presenter mode with
   notes/timer/sync, drawing + laser). The shell lives canonically in
   `runtime/` at the repo root and is always served from there — deck folders
   carry stamped copies purely for self-containment, so shell upgrades reach
   every existing deck immediately.
3. **Wire the loop (done 2026-07-11).** Agent prompts teach the runtime
   conventions; workbench preview reloads on file writes through the
   `/api/decks/:id/runtime/events` SSE hub; the exporter screenshots the runtime
   directly (the `window.__deck` hook reveals all click steps and skips
   transitions); share links serve the runtime.
4. **Ship v1 runtime cleanup (done 2026-07-12).** Removed PPTX import, the
   server's legacy converter export branch, static draft/published builds and
   routes, markdown agent/store paths, legacy themes, and runtime dependencies.
   The founding standalone converter CLI remains available but is unwired from
   the server.
