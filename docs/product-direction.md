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
  `export` (queued jobs spawning the built converter CLI), `preview` (static
  draft/published builds).
- `apps/web` — React 19 + TanStack Query + Halfmoon; dashboard, deck detail,
  workbench (preview iframe + chat), templates, admin, `/client/:token` share
  surface.
- `src/slidev-to-pptx` / `src/pptx-to-slidev` — the converter core.
  Screenshot mode only (Playwright → pptxgenjs full-bleed + EMU verifier).
- `scripts/smoke-*.sh` — app, exporter, security, auth-bridge, auth-org,
  basic; deepagents/postgres smokes are opt-in.

## Phased plan

1. **Consolidation (done 2026-07-02).** Checkpoint commit; removed dead vanilla
   frontend, orphaned packages, pnpm config, preview supervisor + `/live`
   proxy, editable/hybrid export modes; docs rewritten to this direction.
2. **Deck runtime promotion.** Make the custom-html format first-class:
   `deck.json` manifest, per-slide HTML files, keyboard nav + slide index in
   the runtime shell, 2–3 branded scaffolds mined from
   `themes/commercial-profile`, and a written slide-authoring convention for
   the LLM. New decks default to the HTML runtime.
3. **Wire the loop.** Agent prompts teach the runtime conventions; workbench
   preview reloads on file writes (the `/api/decks/:id/runtime/events` SSE hub
   already exists); exporter screenshots the runtime directly instead of
   spawning Slidev; share links verified against the runtime.
4. **Ship v1.** Gate the dev-link auth fallback behind an env flag, refresh the
   smoke suite for the new paths, migrate or archive remaining Slidev decks,
   then remove the transitional Slidev build/preview code and dependencies.
