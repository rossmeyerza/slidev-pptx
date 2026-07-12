# Slidev Removal Scope

Completes phase 4 of `docs/product-direction.md`: remove the transitional
Slidev runtime now that the HTML deck runtime is first-class. Decision
(2026-07-11): **PPTX import is dropped**, not retargeted — it is the only
feature that creates Slidev decks, and no customer has asked for it.

Estimated effort: ~2 days. Each step below is a self-contained commit that
leaves `build:server` + `build:web` + the smoke suite green.

## Decisions

- **PPTX import: removed.** Deletes the feature; users start from templates +
  the agent. Revisit only on real demand (would then be a *PPTX → HTML*
  importer, reusing `src/pptx-to-slidev/parser.ts`'s IR with a new HTML
  generator).
- **Original converter (`src/slidev-to-pptx`, `src/pptx-to-slidev`, `bin/`):
  kept, unwired.** It is the repo's founding standalone CLI, committed and
  tested, and imposes no runtime dep once the server stops calling its `dist`
  build. Not part of this removal; delete later as a separate call if ever.
- **`themes/commercial-profile`: archived then deleted.** Tag `pre-slidev-removal`
  before deletion so the 6.6 MB Slidev reference deck (the asset source for
  `commercial-html`) stays recoverable. `themes/basic`: deleted outright.
- **Legacy decks in existing data** stop previewing after removal. Low stakes
  today (one local dev deck on `commercial-profile`). Deployments with real
  legacy decks: recreate as HTML, or run the standalone converter out-of-band.
  No in-app migration tooling is in scope.

## Surface being removed

| Area | Files / lines | Action |
|---|---|---|
| Slidev build service | `preview/slidevBuild.ts` (323) | delete |
| PPTX import | `export/importer.ts` (105), `/api/imports/pptx`, import UI in `App.jsx`, `importPptxDeck` in `api.js` | delete |
| Legacy PPTX export | `export/exporter.ts` legacy branch (~L233+), `dist/slidev-to-pptx` wiring | delete branch; HTML export via `htmlDeckExporter.ts` stays |
| Agent markdown path | `deepAgentRuntime.ts` `!isWorkspaceDeck` branch + `mode:'markdown'` type; markdown validation in `agent.ts` | delete; agent becomes workspace-only |
| Preview routes | `/draft/:id*`, `/published/:id*` (6 routes), `sendSlidevStatic`, `SlidevBuildService` wiring, `scheduleDraftBuild*` helpers in `routes.ts` | delete |
| Publish | `/api/decks/:id/publish` `slidev.build(...)` call (unconditional today — latent bug for HTML decks) | drop the build call; publish = flip status + publish record; share/deck-host already serve the runtime |
| Deck store | `createFromProject`, `scaffoldMarkdown`, `DEFAULT_MARKDOWN`, slides.md stub writes in `decks.ts` | trim |
| Legacy themes | `themes/basic`, `themes/commercial-profile` | delete (tag first) |
| Deps | `@slidev/cli`, `@slidev/theme-default` | remove from `package.json` |
| Smokes | `smoke-basic.sh` (delete), `smoke-exporter.sh` legacy assertions (delete — covered by `smoke-export-html.sh`), `smoke-app.sh` import + `basic`-activation sections (delete) | update |
| Docs | `product-direction.md` phase 4 → done; `README.md`, `deck-authoring.md` (drop `slides.md` bookkeeping), `AGENTS.md`/`CLAUDE.md` transitional notes | update |

## Sequence (green at every step)

1. **Drop PPTX import.** Route + `importer.ts` + import UI + `api.js` client +
   `smoke-app.sh` import section. Converter's `pptx-to-slidev` half is now
   unused by the server (stays as standalone CLI).
2. **Drop legacy PPTX export branch.** `exporter.ts`: remove the `dist/slidev-to-pptx`
   path; HTML decks already use `htmlDeckExporter.ts`. Trim `smoke-exporter.sh`.
3. **Fix publish + drop static preview routes.** Remove `slidev.build` from
   publish (verify HTML decks publish → runtime via share/deck-host); delete
   `/draft`, `/published`, `sendSlidevStatic`, `SlidevBuildService` wiring and
   `scheduleDraftBuild*`; delete `preview/slidevBuild.ts`.
4. **Agent workspace-only.** Remove the `slides.md`/markdown branch from
   `deepAgentRuntime.ts` and the markdown validation in `agent.ts`; drop the
   `mode:'markdown'` result type. All decks are HTML now.
5. **Trim deck store.** Remove `createFromProject`, `scaffoldMarkdown`,
   `DEFAULT_MARKDOWN`, slides.md stub writes.
6. **Remove themes + deps.** Tag `pre-slidev-removal`; delete `themes/basic`
   and `themes/commercial-profile`; remove `@slidev/cli` + `@slidev/theme-default`
   from `package.json`; `npm install` to update the lockfile.
7. **Docs.** Mark phase 4 done; scrub transitional Slidev language from README,
   deck-authoring, AGENTS/CLAUDE.

## Out of scope

- Deleting the standalone `slidev-to-pptx`/`pptx-to-slidev` converter.
- In-app legacy-deck migration tooling.
- Any change to the HTML runtime, export, or agent behavior beyond removing the
  markdown branch.
