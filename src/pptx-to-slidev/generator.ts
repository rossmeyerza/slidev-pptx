import * as fs from 'fs';
import * as path from 'path';
import {
  IRDeck, IRSlide, IRElement, IRTextElement, IRImageElement,
  IRShapeElement, IRTableElement, IRParagraph, IRTextRun,
} from './types.js';

const PX_PER_INCH = 96;

function inToPx(v: number): number {
  return Math.round(v * PX_PER_INCH * 1000) / 1000;
}

// Slidev mounts each slide in a fixed-size canvas (default 980 wide). We use
// pixel positioning at 96 DPI relative to the slide's intrinsic inch size; the
// slidev viewport handles scaling. To keep the math honest we set canvasWidth
// to slideWidth*96 in the frontmatter so 1 inch = 96 px on screen.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function colorHex(h?: string): string | undefined {
  if (!h) return undefined;
  const clean = h.replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{6}$/.test(clean)) return '#' + clean;
  return undefined;
}

// Metric-compatible fallbacks so layouts stay pixel-accurate when the named
// font isn't installed (esp. on Linux where Arial / Calibri are absent).
const FONT_ALIASES: Record<string, string[]> = {
  arial: ['Arial', 'Liberation Sans', 'Helvetica Neue', 'Helvetica'],
  helvetica: ['Helvetica', 'Arial', 'Liberation Sans'],
  calibri: ['Calibri', 'Carlito', 'Arial', 'Liberation Sans'],
  cambria: ['Cambria', 'Caladea', 'Georgia', 'Times New Roman'],
  'times new roman': ['Times New Roman', 'Liberation Serif', 'Times'],
  georgia: ['Georgia', 'Liberation Serif'],
  'courier new': ['Courier New', 'Liberation Mono', 'Courier'],
  consolas: ['Consolas', 'Liberation Mono', 'Courier New'],
};

function fontStack(family?: string): string {
  // We always emit inside style="..." so any quoting must use single quotes.
  if (!family) return `'Arial','Liberation Sans','Helvetica',sans-serif`;
  const lower = family.toLowerCase().trim();
  const aliases = FONT_ALIASES[lower];
  const list = aliases ? aliases.slice() : [family];
  list.push('sans-serif');
  return list.map((f) => (/\s/.test(f) ? `'${f.replace(/'/g, '')}'` : f)).join(',');
}

function renderRun(run: IRTextRun): string {
  if (!run.text) return '<br/>';
  const styles: string[] = [];
  if (run.bold) styles.push('font-weight:700');
  if (run.italic) styles.push('font-style:italic');
  if (run.underline) styles.push('text-decoration:underline');
  if (run.fontSize) styles.push(`font-size:${run.fontSize}pt`);
  if (run.fontFamily) styles.push(`font-family:${fontStack(run.fontFamily)}`);
  const c = colorHex(run.color);
  if (c) styles.push(`color:${c}`);

  const text = escapeHtml(run.text).replace(/\n/g, '<br/>');
  if (styles.length === 0) return text;
  return `<span style="${styles.join(';')}">${text}</span>`;
}

function renderParagraph(p: IRParagraph, defaultAlign: string): string {
  // Start with a normalised baseline (browser ships <p> with vertical margins,
  // <li> with bullets — we want exact PPTX spacing only).
  const styles = ['margin:0', 'padding:0'];
  const align = p.align || defaultAlign;
  if (align) styles.push(`text-align:${align}`);
  // PPTX defaults to single line spacing; CSS defaults to ~1.2. Override to
  // keep text within the box height unless the paragraph has explicit lnSpc.
  if (p.lineHeightPt) styles.push(`line-height:${p.lineHeightPt}pt`);
  else styles.push('line-height:1.15');
  if (p.spaceBeforePt) styles.push(`margin-top:${p.spaceBeforePt}pt`);
  if (p.spaceAfterPt) styles.push(`margin-bottom:${p.spaceAfterPt}pt`);

  const inner = p.runs.length === 0 ? '<br/>' : p.runs.map(renderRun).join('');
  const tag = p.bullet ? 'li' : 'p';
  return `<${tag} style="${styles.join(';')}">${inner}</${tag}>`;
}

function paragraphsToHtml(paragraphs: IRParagraph[], defaultAlign: string): string {
  if (paragraphs.length === 0) return '';
  // Group consecutive bullet/number paragraphs into ul/ol
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (!listType || buf.length === 0) return;
    out.push(`<${listType} style="margin:0;padding-left:1.2em">${buf.join('')}</${listType}>`);
    buf = [];
    listType = null;
  };

  for (const p of paragraphs) {
    if (p.bullet) {
      const wantType: 'ul' | 'ol' = p.bullet.kind === 'number' ? 'ol' : 'ul';
      if (listType && listType !== wantType) flush();
      listType = wantType;
      buf.push(renderParagraph(p, defaultAlign));
    } else {
      flush();
      out.push(renderParagraph(p, defaultAlign));
    }
  }
  flush();
  return out.join('');
}

function commonBoxStyles(el: IRElement): string[] {
  const styles = [
    'position:absolute',
    `left:${inToPx(el.x)}px`,
    `top:${inToPx(el.y)}px`,
    `width:${inToPx(el.w)}px`,
    `height:${inToPx(el.h)}px`,
    `z-index:${el.zIndex}`,
  ];
  if (el.rotation) {
    styles.push(`transform:rotate(${el.rotation}deg)`);
    styles.push('transform-origin:center center');
  }
  return styles;
}

function renderText(el: IRTextElement): string {
  const styles = commonBoxStyles(el);
  if (el.fill?.color) styles.push(`background-color:${colorHex(el.fill.color)}`);
  if (el.border?.color && el.border.widthPt) {
    styles.push(`border:${el.border.widthPt}pt solid ${colorHex(el.border.color)}`);
  }
  if (el.paddingPt) {
    const p = el.paddingPt;
    styles.push(`padding:${p.top}pt ${p.right}pt ${p.bottom}pt ${p.left}pt`);
  }
  styles.push('box-sizing:border-box');
  // PPTX text boxes do NOT clip overflow — paragraph spcBef/lnSpc commonly
  // push text past the nominal box height, and clipping it breaks fidelity.
  styles.push('display:flex');
  styles.push('flex-direction:column');
  const justify = el.vAlign === 'middle' ? 'center' : el.vAlign === 'bottom' ? 'flex-end' : 'flex-start';
  styles.push(`justify-content:${justify}`);

  const inner = paragraphsToHtml(el.paragraphs, 'left');
  return `<div style="${styles.join(';')}"><div style="width:100%">${inner}</div></div>`;
}

function renderImage(el: IRImageElement, assetDir: string): string {
  const styles = commonBoxStyles(el);
  const src = `${assetDir}/${el.src}`;
  return `<img src="${src}" style="${styles.join(';')};object-fit:fill"/>`;
}

function renderShape(el: IRShapeElement): string {
  const styles = commonBoxStyles(el);
  if (el.fill?.color) styles.push(`background-color:${colorHex(el.fill.color)}`);
  if (el.border?.color && el.border.widthPt) {
    styles.push(`border:${el.border.widthPt}pt solid ${colorHex(el.border.color)}`);
  }
  if (el.prstGeom === 'ellipse') styles.push('border-radius:50%');
  else if (el.borderRadius) styles.push(`border-radius:${el.borderRadius}px`);
  return `<div style="${styles.join(';')}"></div>`;
}

function renderTable(el: IRTableElement): string {
  const styles = commonBoxStyles(el);
  styles.push('border-collapse:collapse');
  const colgroup = el.colWidths
    ? `<colgroup>${el.colWidths.map((w) => `<col style="width:${inToPx(w)}px"/>`).join('')}</colgroup>`
    : '';
  const body = el.rows.map((row) => {
    const h = row.height ? `height:${inToPx(row.height)}px;` : '';
    const cells = row.cells.map((c) => {
      const cellStyles = [
        'border:0.5pt solid #CCCCCC',
        'padding:2pt 4pt',
        'vertical-align:' + (c.vAlign === 'middle' ? 'middle' : c.vAlign === 'bottom' ? 'bottom' : 'top'),
      ];
      if (c.fill?.color) cellStyles.push(`background-color:${colorHex(c.fill.color)}`);
      const rs = c.rowSpan && c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '';
      const cs = c.colSpan && c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '';
      const inner = paragraphsToHtml(c.paragraphs, 'left');
      return `<td${rs}${cs} style="${cellStyles.join(';')}">${inner}</td>`;
    }).join('');
    return `<tr style="${h}">${cells}</tr>`;
  }).join('');

  return `<table style="${styles.join(';')}">${colgroup}<tbody>${body}</tbody></table>`;
}

function renderElement(el: IRElement, assetDir: string): string {
  switch (el.type) {
    case 'text': return renderText(el);
    case 'image': return renderImage(el, assetDir);
    case 'shape': return renderShape(el);
    case 'table': return renderTable(el);
  }
}

function renderSlide(slide: IRSlide, deck: IRDeck, assetDir: string): string {
  const widthPx = inToPx(deck.slideWidth);
  const heightPx = inToPx(deck.slideHeight);
  const bg = colorHex(slide.background?.color) || '#FFFFFF';

  // Sort by zIndex so paint order matches PPTX z-order
  const elements = [...slide.elements].sort((a, b) => a.zIndex - b.zIndex);

  const inner = elements.map((el) => renderElement(el, assetDir)).join('');

  // position:absolute + inset:0 pins to the .slidev-page container, escaping
  // any padding the active layout applies.
  return `<div style="position:absolute;inset:0;width:${widthPx}px;height:${heightPx}px;background-color:${bg};overflow:hidden;font-family:Arial,sans-serif;line-height:1">${inner}</div>`;
}

export interface GenerateOptions {
  outDir: string;
  /** Folder name (relative to slides.md) where image assets are written. */
  assetDirName?: string;
}

export async function generateSlidev(deck: IRDeck, opts: GenerateOptions): Promise<void> {
  const outDir = opts.outDir;
  const assetDirName = opts.assetDirName ?? 'assets';
  const assetDir = path.join(outDir, assetDirName);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  const layoutsDir = path.join(outDir, 'layouts');
  fs.mkdirSync(layoutsDir, { recursive: true });

  // Write asset files
  for (const [name, buf] of deck.assets) {
    fs.writeFileSync(path.join(assetDir, name), buf);
  }

  // A no-op layout so our absolute-positioned root pins to the full slide page
  // without any padding from the default theme layouts.
  fs.writeFileSync(
    path.join(layoutsDir, 'none.vue'),
    `<template>\n  <div class="slidev-layout none-layout" style="padding:0;position:relative;width:100%;height:100%">\n    <slot />\n  </div>\n</template>\n\n<style scoped>\n.none-layout { padding: 0 !important; }\n</style>\n`,
  );

  const canvasWidth = inToPx(deck.slideWidth);
  const canvasHeight = inToPx(deck.slideHeight);

  const frontmatter = [
    '---',
    'theme: default',
    `title: Converted Presentation`,
    `canvasWidth: ${canvasWidth}`,
    `aspectRatio: ${(deck.slideWidth / deck.slideHeight).toFixed(6)}`,
    'layout: none',
    '---',
    '',
    `<!-- pptx-to-slidev: ${deck.slides.length} slides, ${canvasWidth}×${canvasHeight}px canvas -->`,
    '',
    '<style>',
    '/* Map common PPTX fonts to metric-compatible substitutes so layout',
    '   stays pixel-stable on systems without the original font installed. */',
    "@font-face { font-family: 'Arial'; src: local('Arial'), local('Liberation Sans'), local('LiberationSans'), local('Helvetica'); }",
    "@font-face { font-family: 'Arial'; font-weight: bold; src: local('Arial Bold'), local('Liberation Sans Bold'), local('LiberationSans-Bold'); }",
    "@font-face { font-family: 'Arial'; font-style: italic; src: local('Arial Italic'), local('Liberation Sans Italic'), local('LiberationSans-Italic'); }",
    "@font-face { font-family: 'Calibri'; src: local('Calibri'), local('Carlito'); }",
    "@font-face { font-family: 'Cambria'; src: local('Cambria'), local('Caladea'); }",
    "@font-face { font-family: 'Times New Roman'; src: local('Times New Roman'), local('Liberation Serif'); }",
    "@font-face { font-family: 'Courier New'; src: local('Courier New'), local('Liberation Mono'); }",
    '.slidev-page, .slidev-layout { padding: 0 !important; }',
    '.slidev-page * { box-sizing: border-box; }',
    '.slidev-page p, .slidev-page ul, .slidev-page ol, .slidev-page li {',
    '  margin: 0 !important; padding: 0; list-style-position: inside;',
    '}',
    '</style>',
    '',
  ].join('\n');

  const slidePages: string[] = [frontmatter];

  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const html = renderSlide(slide, deck, `./${assetDirName}`);
    if (i === 0) {
      slidePages.push(html);
    } else {
      slidePages.push('---\nlayout: none\n---\n\n' + html);
    }
  }

  const md = slidePages.join('\n\n');
  fs.writeFileSync(path.join(outDir, 'slides.md'), md, 'utf8');

  // Helpful sidecar: a minimal package.json so users can `npm i && npm run dev`
  const pkg = {
    name: 'converted-slidev-deck',
    private: true,
    scripts: {
      dev: 'slidev',
      build: 'slidev build',
      export: 'slidev export',
    },
    devDependencies: {
      '@slidev/cli': '^0.49.0',
      '@slidev/theme-default': '^0.25.0',
      vue: '^3.4.0',
    },
  };
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2));
}
