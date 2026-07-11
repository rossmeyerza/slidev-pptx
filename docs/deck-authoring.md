# Deck Authoring Conventions (HTML Runtime)

These are the rules for anyone — human or LLM agent — editing an HTML-runtime
deck. The agent's system prompt should enforce them.

## Deck layout

```
<deck-folder>/
  deck.json        # manifest: title, transition, ordered slide list
  theme.css        # design tokens, slide layouts, components (edit freely)
  slides/
    01-cover.html  # one <section class="slide"> fragment per file
    02-….html
  assets/          # images, fonts, logos referenced by slides/theme
  index.html       # runtime shell — DO NOT EDIT
  runtime.js       # runtime shell — DO NOT EDIT
  runtime.css      # runtime shell — DO NOT EDIT
```

The runtime shell files are stamped copies of the canonical shell in
`runtime/` at the repo root; the server always serves the canonical version,
so per-deck copies exist only to keep deck folders self-contained. Never edit
either copy as part of deck work.

`slides.md`, `package.json`, and `meta.json` are platform bookkeeping; never
edit them, and never reference them from slides (the runtime refuses to serve
them).

## The canvas

- Every slide renders on a **fixed 1280x720 px stage** that the runtime scales
  to fit the viewport. Design in px against that canvas — no `vw`/`vh` units.
- Slides must not scroll. If content overflows 1280x720, cut content or split
  the slide; do not shrink text below readable sizes.
- The stage background defaults to white; give the slide its own background
  via a layout class or inline style when needed.

## Slide files

- One file per slide under `slides/`, named `NN-slug.html` (zero-padded order
  prefix, kebab-case slug). The order that matters is the `slides` array in
  `deck.json` — keep filenames and manifest order in sync.
- Each file contains exactly one fragment rooted at
  `<section class="slide …" data-title="…">`. No `<html>`, `<head>`, or
  `<body>` wrappers, no `<script>` tags, no external CDN references.
- `data-title` feeds the slide overview and goto search; keep it short.
- Reference assets with relative paths (`assets/…`).

## Build steps (progressive reveal)

- Add `data-click` to any element that should appear on a click/keypress,
  Slidev-v-click style. Elements reveal one per press, in DOM order.
- `data-click="3"` pins an element to an explicit step; bare `data-click`
  auto-increments. Steps can be shared (two elements with `data-click="2"`
  appear together).
- Navigation advances through all clicks before moving to the next slide.
  PPTX export always captures the fully-revealed slide.

## Presenter notes

- Put speaker notes in `<aside class="notes">…</aside>` inside the slide
  section. Notes never render on the stage; they appear in presenter mode
  (with next-slide preview and timer). Plain HTML is fine.

## deck.json

- `title` — deck title (stamped by the platform on creation).
- `transition` — slide transition: `"slide"` (directional push, default for
  new decks), `"fade"`, or `"none"`.
- `slides` — ordered array of slide file paths.

## Adding, removing, reordering slides

1. Create/delete the file under `slides/`.
2. Update the `slides` array in `deck.json` to match.
3. Renumber file prefixes when order changes so the folder reads in deck order.

## Styling

- Put shared visual decisions in `theme.css`: design tokens on `:root`,
  layout classes (`layout-cover`, `layout-split`, `layout-statement`,
  `layout-grid`), and components (`data-card`, `stat`, `eyebrow`, `lead`).
- Prefer existing theme classes over per-slide inline styles; add a new theme
  class when a pattern repeats. Inline styles are fine for one-off tweaks.
- Keep the deck's fonts self-hosted under `assets/fonts` (`@font-face` in
  `theme.css`). No external font or asset URLs — decks must render offline
  and export deterministically.
- The runtime chrome accent color is `--deck-primary` (default `#3ab9d5`);
  a theme may override it on `:root` to match the deck brand.
- Animations are allowed for presentation polish but must settle quickly; the
  PPTX export screenshots the final state of each slide.

## Runtime behavior (for reference, not for editing)

The runtime shell reimplements Slidev's presentation UI in vanilla JS:

- **Navigation**: arrows/space advance through clicks then slides
  (Shift+arrow or Up/Down skips clicks); Home/End; clicking the right/left
  half of a slide; `#/N` or `#/N/C` hash routing (slide/click).
- **Chrome**: hover the bottom-left corner for the icon bar — fullscreen,
  prev/next, overview, laser pointer, drawing, presenter mode, slide counter
  (click it for goto).
- **Overview** (`o`): grid of live slide thumbnails; type a number, arrows +
  Enter, or click to jump.
- **Goto** (`g`): jump by slide number or title search.
- **Presenter mode** (`?presenter`): current + next-slide panels, notes,
  timer; navigation and laser sync across windows via BroadcastChannel.
- **Drawing**: pen/line/arrow/ellipse/rect, 7 colors, adjustable width,
  eraser, undo/redo/clear; annotations are per-slide and session-only.
- The preview auto-reloads when deck files change (SSE on
  `/api/decks/:id/runtime/events`).
- Export tooling drives `window.__deck` (`count`, `current()`, `go(n)`) to
  screenshot each slide; `go(n)` lands with all clicks revealed and
  transitions disabled.
