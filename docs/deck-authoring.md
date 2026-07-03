# Deck Authoring Conventions (HTML Runtime)

These are the rules for anyone — human or LLM agent — editing an HTML-runtime
deck. The agent's system prompt should enforce them.

## Deck layout

```
<deck-folder>/
  deck.json        # manifest: title + ordered slide list (edit to add/reorder)
  theme.css        # design tokens, slide layouts, components (edit freely)
  slides/
    01-cover.html  # one <section class="slide"> fragment per file
    02-….html
  assets/          # images, fonts, logos referenced by slides/theme
  index.html       # runtime shell — DO NOT EDIT
  runtime.js       # runtime shell — DO NOT EDIT
  runtime.css      # runtime shell — DO NOT EDIT
```

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
- `data-title` feeds the slide-index overlay; keep it short.
- Reference assets with relative paths (`assets/…`).

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
- Animations are allowed for presentation polish but must settle quickly; the
  PPTX export screenshots the final state of each slide.

## Runtime behavior (for reference, not for editing)

- Navigation: arrow keys / space / PageUp / PageDown / Home / End, on-screen
  controls, `#/N` hash routing, and a slide-index overlay (`g` or the ☰
  button).
- The preview auto-reloads when deck files change (SSE on
  `/api/decks/:id/runtime/events`).
- Export tooling drives `window.__deck` (`count`, `current()`, `go(n)`) to
  screenshot each slide.
