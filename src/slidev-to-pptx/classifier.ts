import { DOMNode, IRElement, IRBaseElement, IRTableElement, IRTableCell } from './types.js';

const PX_PER_INCH = 96;
const SLIDE_W_PX = 960;
const SLIDE_H_PX = 540;

export type FontMappingMode = 'exact' | 'safe';

/**
 * Generic CSS family fallbacks. These should always be normalized because
 * PowerPoint needs a concrete font name, not a CSS generic family token.
 */
export const GENERIC_FONT_FAMILY_MAP: Record<string, string> = {
  'monospace': 'Courier New',
  'sans-serif': 'Arial',
  'serif': 'Times New Roman',
  'system-ui': 'Arial',
  'ui-sans-serif': 'Arial',
  'ui-serif': 'Times New Roman',
  'ui-monospace': 'Courier New',
};

/**
 * Optional safe-mode fallbacks for web or brand fonts that may not exist in
 * the PowerPoint environment.
 */
export const SAFE_FONT_FAMILY_MAP: Record<string, string> = {
  'TCCC-UnityHeadline': 'Arial',
  'TCCC-UnityText': 'Arial',
  'Inter': 'Arial',
  'Helvetica': 'Arial',
};

let currentFontMappingMode: FontMappingMode = 'exact';

export function setFontMappingMode(mode: FontMappingMode) {
  currentFontMappingMode = mode;
}

// Convert px to inches
function px2in(px: number): number {
  return px / PX_PER_INCH;
}

// Parse CSS color to hex
function colorToHex(color: string): string {
  if (color.startsWith('#')) return color;
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, '0');
    const g = parseInt(match[2]).toString(16).padStart(2, '0');
    const b = parseInt(match[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return '#000000';
}

// Check if a color is transparent
function isTransparent(color: string): boolean {
  if (!color) return true;
  if (color === 'transparent') return true;
  if (color === 'rgba(0, 0, 0, 0)') return true;
  const match = color.match(/rgba\([^)]*,\s*0\s*\)/);
  return !!match;
}

// Parse font-weight to boolean
function isBold(weight: string): boolean {
  const n = parseInt(weight);
  if (!isNaN(n)) return n >= 600;
  return weight === 'bold' || weight === 'bolder';
}

// Parse text-align
function parseAlign(align: string): 'left' | 'center' | 'right' {
  if (align === 'center' || align === '-webkit-center') return 'center';
  if (align === 'right' || align === 'end') return 'right';
  return 'left';
}

// Parse font size from CSS
function parseFontSize(size: string): number {
  const px = parseFloat(size);
  if (isNaN(px)) return 12;
  return Math.round(px * 0.75);
}

function parseLineHeight(lineHeight: string, fontSizePt: number): number | undefined {
  if (!lineHeight || lineHeight === 'normal') return undefined;

  if (lineHeight.endsWith('px')) {
    const px = parseFloat(lineHeight);
    if (isNaN(px)) return undefined;
    return Math.round(px * 0.75);
  }

  const n = parseFloat(lineHeight);
  if (isNaN(n)) return undefined;

  if (lineHeight.endsWith('%')) {
    return Math.round(fontSizePt * (n / 100));
  }

  if (/^[0-9.]+$/.test(lineHeight)) {
    return Math.round(fontSizePt * n);
  }

  return undefined;
}

export function classifyNodes(nodes: DOMNode[]): IRElement[] {
  const elements: IRElement[] = [];
  flattenAndClassify(nodes, elements, new Set());
  // Sort by z-index then vertical position
  elements.sort((a, b) => a.zIndex - b.zIndex || a.y - b.y || a.x - b.x);
  // Deduplicate overlapping text boxes with the same content
  return deduplicateText(elements);
}

// Remove text elements that overlap and have the same (or subset) content
function deduplicateText(elements: IRElement[]): IRElement[] {
  const remove = new Set<number>();

  for (let i = 0; i < elements.length; i++) {
    const a = elements[i];
    if (a.type !== 'text' || remove.has(i)) continue;

    for (let j = 0; j < elements.length; j++) {
      if (i === j || remove.has(j)) continue;
      const b = elements[j];
      if (b.type !== 'text') continue;

      const aEl = a as IRBaseElement;
      const bEl = b as IRBaseElement;

      const overlapX = Math.max(0, Math.min(aEl.x + aEl.w, bEl.x + bEl.w) - Math.max(aEl.x, bEl.x));
      const overlapY = Math.max(0, Math.min(aEl.y + aEl.h, bEl.y + bEl.h) - Math.max(aEl.y, bEl.y));
      const overlapArea = overlapX * overlapY;
      const aArea = aEl.w * aEl.h;
      const bArea = bEl.w * bEl.h;

      if (overlapArea < Math.min(aArea, bArea) * 0.5) continue;

      if (bEl.content && aEl.content && bEl.content.includes(aEl.content) && bArea >= aArea) {
        remove.add(i);
        break;
      }
    }
  }

  return elements.filter((_, index) => !remove.has(index));
}

function flattenAndClassify(nodes: DOMNode[], result: IRElement[], processedTexts: Set<string>) {
  for (const node of nodes) {
    let x = node.x;
    let y = node.y;
    let w = node.width;
    let h = node.height;

    if (x + w < 0 || y + h < 0) continue;
    if (x > SLIDE_W_PX || y > SLIDE_H_PX) continue;

    if (x < 0) {
      w += x;
      x = 0;
    }
    if (y < 0) {
      h += y;
      y = 0;
    }

    if (w <= 0 || h <= 0) continue;
    if (w < 2 && h < 2) continue;

    // Image element, including background-image on non-img nodes
    if (node.imageSrc) {
      result.push({
        type: 'image',
        src: node.imageSrc,
        x: px2in(x),
        y: px2in(y),
        w: px2in(w),
        h: px2in(h),
        zIndex: node.zIndex,
      });
      continue;
    }

    // Table element: build a proper IRTableElement
    if (node.tag === 'table') {
      const tableEl = buildTableElement(node, x, y, w, h);
      if (tableEl) {
        result.push(tableEl);
      }
      continue; // Don't recurse into table children
    }

    // Code block
    if (node.tag === 'pre' || (node.tag === 'code' && node.text)) {
      const codeText = node.text || '';
      result.push({
        type: 'text',
        content: codeText,
        x: px2in(x),
        y: px2in(y),
        w: px2in(w),
        h: px2in(h),
        zIndex: node.zIndex,
        fontSize: parseFontSize(node.styles.fontSize || '14px'),
        bold: false,
        color: colorToHex(node.styles.color || 'rgb(0,0,0)'),
        align: 'left',
        fontFamily: 'Courier New',
        backgroundColor: isTransparent(node.styles.backgroundColor) ? undefined : colorToHex(node.styles.backgroundColor),
      });
      continue;
    }

    // Inline SVGs are serialized upstream in extractor as image data URIs.
    if (node.tag === 'svg') {
      if (node.imageSrc) {
        result.push({
          type: 'image',
          src: node.imageSrc,
          x: px2in(x),
          y: px2in(y),
          w: px2in(w),
          h: px2in(h),
          zIndex: node.zIndex,
        });
      }
      continue;
    }

    // Background shape (div/section with visible background or border)
    const hasBackground = !isTransparent(node.styles.backgroundColor);
    const borderWidth = parseFloat(node.styles.borderWidth) || 0;
    const hasBorder = borderWidth > 0 && !isTransparent(node.styles.borderColor);

    if ((hasBackground || hasBorder) && w > 10 && h > 10) {
      result.push({
        type: 'shape',
        x: px2in(x),
        y: px2in(y),
        w: px2in(w),
        h: px2in(h),
        zIndex: node.zIndex,
        backgroundColor: hasBackground ? colorToHex(node.styles.backgroundColor) : undefined,
        borderRadius: parseFloat(node.styles.borderRadius) || 0,
        borderColor: hasBorder ? colorToHex(node.styles.borderColor) : undefined,
        borderWidth: borderWidth,
      });
    }

    // Text: only extract from leaf-like nodes to prevent duplicates
    const hasTextChildren = node.children?.some(c => c.text && c.text.length > 0);
    const shouldExtractText = node.text && node.text.length > 0 && (
      node.isLeaf ||
      !hasTextChildren ||
      ['h1','h2','h3','h4','h5','h6','p','span','strong','em','b','i','li','td','th','label','a'].includes(node.tag)
    );

    if (shouldExtractText && node.text) {
      const posKey = `${Math.round(x)},${Math.round(y)},${node.text.substring(0, 40)}`;
      if (!processedTexts.has(posKey)) {
        processedTexts.add(posKey);

        const fontSize = parseFontSize(node.styles.fontSize || '16px');
        const el: IRBaseElement = {
          type: 'text',
          content: node.text,
          x: px2in(x),
          y: px2in(y),
          w: px2in(Math.max(w, 20)),
          h: px2in(Math.max(h, 10)),
          zIndex: node.zIndex,
          fontSize,
          lineHeight: parseLineHeight(node.styles.lineHeight || '', fontSize),
          bold: isBold(node.styles.fontWeight || '400'),
          italic: node.styles.fontStyle === 'italic',
          color: colorToHex(node.styles.color || 'rgb(0,0,0)'),
          align: parseAlign(node.styles.textAlign || 'left'),
          fontFamily: cleanFontFamily(node.styles.fontFamily || 'Arial'),
        };

        result.push(el);
      }
    }

    // Recurse into children (but not for tables, code blocks, or images)
    if (node.children && node.children.length > 0) {
      flattenAndClassify(node.children, result, processedTexts);
    }
  }
}

// Build a proper IRTableElement from a table DOM node
function buildTableElement(tableNode: DOMNode, x: number, y: number, w: number, h: number): IRTableElement | null {
  const rows: { cells: IRTableCell[] }[] = [];

  function findRows(node: DOMNode) {
    if (node.tag === 'tr') {
      const cells: IRTableCell[] = [];
      for (const child of (node.children || [])) {
        if (child.tag === 'td' || child.tag === 'th') {
          cells.push({
            text: (child.text || '').trim(),
            bold: child.tag === 'th' || isBold(child.styles?.fontWeight || '400'),
            color: child.styles?.color ? colorToHex(child.styles.color) : undefined,
            align: child.styles?.textAlign ? parseAlign(child.styles.textAlign) : undefined,
          });
        }
      }
      if (cells.length > 0) rows.push({ cells });
    }
    for (const child of (node.children || [])) {
      findRows(child);
    }
  }

  findRows(tableNode);
  if (rows.length === 0) return null;

  return {
    type: 'table',
    x: px2in(x),
    y: px2in(y),
    w: px2in(Math.max(w, 50)),
    h: px2in(Math.max(h, 20)),
    zIndex: tableNode.zIndex,
    rows,
    fontSize: parseFontSize(tableNode.styles.fontSize || '10px'),
    fontFamily: cleanFontFamily(tableNode.styles.fontFamily || 'Arial'),
  };
}

export function cleanFontFamily(family: string): string {
  const first = family.split(',')[0].trim().replace(/["']/g, '');
  if (!first) return 'Arial';

  for (const [key, value] of Object.entries(GENERIC_FONT_FAMILY_MAP)) {
    if (first.includes(key)) return value;
  }

  if (currentFontMappingMode === 'safe') {
    for (const [key, value] of Object.entries(SAFE_FONT_FAMILY_MAP)) {
      if (first.includes(key)) return value;
    }
  }

  return first;
}
