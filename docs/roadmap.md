# GTM Roadmap

Product review 2026-07-11 (post agent-wiring/HMR/onboarding). The core loop —
brief an agent, watch branded slides build live, share a link — works and is
differentiated. The gaps are in the trust/completeness layer. Three milestones
to client-facing GTM.

## Milestone 1 — "The product doesn't lie" (P0, shipped 2026-07-11)

1. **Export retarget + PDF.** PPTX export still spawns the Slidev CLI against
   `slides.md`, which for HTML-runtime decks is a stub — the product's native
   format exports a broken file. Retarget: drive the deck runtime in Playwright
   via `window.__deck`, screenshot the 1280x720 stage per slide, assemble
   full-bleed PPTX (and PDF via a print page) — no per-deck build. Keep the
   verifier.
2. **Snapshot/revert.** Copy editable deck files into `.snapshots/<ts>-<run>/`
   before every agent run (retain last 10); `POST /api/decks/:id/revert`
   restores the latest; "Undo last agent change" in the workbench. The #1
   trust feature: a bad run must never cost real work.
3. **Asset upload.** `POST /api/decks/:id/assets` (base64 JSON, same pattern
   as PPTX import), jailed to `assets/`, type/size limits; upload button in
   the workbench. Unblocks real imagery in client decks.
4. **Retire Slidev from the user surface.** Scaffolds without `deck.json`
   default to inactive (admins can re-enable via curation); PPTX import is
   admin-only and labeled legacy.
5. **Auth hardening.** Dev-link fallback gated behind `AUTH_DEV_LINK=true`;
   rate limits on login requests and share-password attempts.

## Milestone 2 — "Daily-drivable"

- Human edit path: per-slide instruction targeting; raw slide drawer or
  inline text fixes on the preview.
- Deck lifecycle UI: rename, delete, duplicate; "save deck as template".
- Agent run summaries in chat ("changed slides 2, 4; added slide 5") paired
  with revert.
- Share management: expiry UI (column exists), per-link visitor log
  ("who viewed, when"), download toggle.
- Rename the product (it is named after the retired runtime).

## Milestone 3 — "Client-facing GTM"

- Template thumbnails + template-from-deck flow; longer term a brand-kit
  builder (logo/colors/fonts -> generated theme).
- Notifications: share viewed / edit requested emails; export-finished toasts.
- Deployment story: docker-compose/deploy guide, `.data` backup, error
  tracking, per-user/deck usage metering.
- Privacy notice on share gates (visitor PII capture).

## Explicit non-goals (hold the line)

Real-time CRDT co-editing, comments/annotations (v1.1 candidate), editable
PPTX, public API, template marketplace, mobile authoring.
