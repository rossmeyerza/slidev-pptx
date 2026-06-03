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
