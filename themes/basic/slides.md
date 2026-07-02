---
title: Slidev Agent Platform
routerMode: hash
info: Basic v1 scaffold for creating, publishing, and exporting decks.
class: text-left
drawings:
  persist: false
transition: slide-left
---

# Slidev Agent Platform

Basic v1 scaffold for a deck that can be created, published, and exported to PPTX.

<div class="mt-12 grid grid-cols-3 gap-4 text-sm">
  <div class="rounded border border-slate-300 p-4">
    <div class="text-xs uppercase tracking-wider text-slate-500">Create</div>
    <div class="mt-2 font-semibold">Start from a known deck shape.</div>
  </div>
  <div class="rounded border border-slate-300 p-4">
    <div class="text-xs uppercase tracking-wider text-slate-500">Publish</div>
    <div class="mt-2 font-semibold">Build a static Slidev site.</div>
  </div>
  <div class="rounded border border-slate-300 p-4">
    <div class="text-xs uppercase tracking-wider text-slate-500">Export</div>
    <div class="mt-2 font-semibold">Verify PPTX output fidelity.</div>
  </div>
</div>

<!--
Presenter note: introduce the scaffold as the smallest useful platform slice.
-->

---
layout: two-cols-header
---

# Basic Deck Contract

::left::

## Included

- Slidev-compatible `slides.md`
- Minimal `package.json` scripts
- Local asset reference
- Five deterministic slides for export verification

::right::

## Not Included

- No app server assumptions
- No package installation
- No custom theme dependency
- No generated binary output

---
layout: image-right
image: ./assets/agent-platform-mark.svg
backgroundSize: contain
---

# Local Asset Smoke

This slide verifies that local assets resolve through Slidev and survive the screenshot-based PPTX export path.

- Relative image path
- Transparent SVG
- Static content suitable for CI smoke checks

---
layout: center
class: text-center
---

# Publish Check

The scaffold publishes as a static Slidev site with:

`slidev build slides.md --out dist`

The smoke test treats a generated `dist/index.html` as the publish artifact.

---
layout: end
---

# Export Check

The scaffold exports with the repo converter:

`bin/slidev-to-pptx.js slides.md dist/basic.pptx`

Then verifies the PPTX has five full-slide screenshot images.
