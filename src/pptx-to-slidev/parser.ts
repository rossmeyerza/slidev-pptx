import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import * as path from 'path';
import {
  IRDeck, IRSlide, IRElement, IRTextElement, IRImageElement,
  IRShapeElement, IRTableElement, IRParagraph, IRTextRun, IRTableCell,
} from './types.js';

const EMU_PER_INCH = 914400;
const emu = (v: any) => (v == null ? 0 : Number(v) / EMU_PER_INCH);

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  preserveOrder: false,
  removeNSPrefix: false,
  isArray: (name) => {
    // Always treat these as arrays for predictable shape
    return [
      'p:sp', 'p:pic', 'p:grpSp', 'p:graphicFrame', 'p:cxnSp',
      'a:p', 'a:r', 'a:tr', 'a:tc', 'a:gridCol',
      'Relationship',
    ].includes(name);
  },
});

interface Rels {
  [rId: string]: { type: string; target: string };
}

function arr<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseRels(xmlText: string): Rels {
  const parsed = xml.parse(xmlText);
  const rels: Rels = {};
  const list = arr(parsed?.Relationships?.Relationship);
  for (const r of list) {
    rels[r['@_Id']] = { type: r['@_Type'], target: r['@_Target'] };
  }
  return rels;
}

function srgbColor(node: any): string | undefined {
  if (!node) return undefined;
  const solid = node['a:solidFill'];
  if (solid) {
    if (solid['a:srgbClr']) return String(solid['a:srgbClr']['@_val']).toUpperCase();
    if (solid['a:schemeClr']) {
      // We don't resolve scheme colors fully; fall back to a sensible default
      return undefined;
    }
  }
  return undefined;
}

function parseRun(r: any): IRTextRun {
  const rPr = r['a:rPr'] || {};
  const colorHex = srgbColor(rPr);
  const latin = rPr['a:latin'];
  const fontFamily = latin?.['@_typeface'];
  const sz = rPr['@_sz'] ? Number(rPr['@_sz']) / 100 : undefined;
  const text = r['a:t'] != null ? String(r['a:t']) : '';
  return {
    text,
    bold: rPr['@_b'] === '1' || rPr['@_b'] === 1 || rPr['@_b'] === true || undefined,
    italic: rPr['@_i'] === '1' || rPr['@_i'] === 1 || rPr['@_i'] === true || undefined,
    underline: rPr['@_u'] && rPr['@_u'] !== 'none' || undefined,
    fontSize: sz,
    fontFamily,
    color: colorHex,
  };
}

function parseParagraph(p: any): IRParagraph {
  const pPr = p['a:pPr'] || {};
  const runs: IRTextRun[] = arr(p['a:r']).map(parseRun);

  // Plain break-only paragraphs still create empty lines we should preserve.
  if (runs.length === 0 && p['a:br'] !== undefined) {
    runs.push({ text: '' });
  }

  const align = pPr['@_algn'];
  const alignMap: Record<string, IRParagraph['align']> = {
    l: 'left', ctr: 'center', r: 'right', just: 'justify',
  };

  const lnSpc = pPr['a:lnSpc'];
  let lineHeightPt: number | undefined;
  if (lnSpc?.['a:spcPts']) lineHeightPt = Number(lnSpc['a:spcPts']['@_val']) / 100;

  const spcBef = pPr['a:spcBef']?.['a:spcPts'];
  const spcAft = pPr['a:spcAft']?.['a:spcPts'];

  // Bullets: a:buChar / a:buAutoNum present, or a:buNone explicitly absent
  let bullet: IRParagraph['bullet'];
  if (pPr['a:buChar']) bullet = { kind: 'bullet', char: pPr['a:buChar']['@_char'] };
  else if (pPr['a:buAutoNum']) bullet = { kind: 'number' };

  return {
    runs,
    align: align ? alignMap[align] : undefined,
    bullet,
    indentLevel: pPr['@_lvl'] ? Number(pPr['@_lvl']) : undefined,
    lineHeightPt,
    spaceBeforePt: spcBef ? Number(spcBef['@_val']) / 100 : undefined,
    spaceAfterPt: spcAft ? Number(spcAft['@_val']) / 100 : undefined,
  };
}

function parseTxBody(txBody: any): IRParagraph[] {
  const paras = arr(txBody['a:p']);
  return paras.map(parseParagraph);
}

function parseXfrm(spPr: any): { x: number; y: number; w: number; h: number; rotation: number } {
  const xfrm = spPr?.['a:xfrm'];
  const off = xfrm?.['a:off'];
  const ext = xfrm?.['a:ext'];
  return {
    x: emu(off?.['@_x']),
    y: emu(off?.['@_y']),
    w: emu(ext?.['@_cx']),
    h: emu(ext?.['@_cy']),
    rotation: xfrm?.['@_rot'] ? Number(xfrm['@_rot']) / 60000 : 0,
  };
}

function parseFill(spPr: any) {
  const color = srgbColor(spPr);
  return color ? { color } : undefined;
}

function parseBorder(spPr: any) {
  const ln = spPr?.['a:ln'];
  if (!ln) return undefined;
  const color = srgbColor(ln);
  const widthEmu = ln['@_w'] ? Number(ln['@_w']) : undefined;
  // EMU width → points (1 pt = 12700 EMU)
  const widthPt = widthEmu ? widthEmu / 12700 : undefined;
  if (!color && !widthPt) return undefined;
  return { color, widthPt };
}

function parseShape(sp: any, zIndex: number): IRElement | null {
  const spPr = sp['p:spPr'] || {};
  const { x, y, w, h, rotation } = parseXfrm(spPr);
  if (w <= 0 || h <= 0) return null;

  const txBody = sp['p:txBody'];
  const paragraphs = txBody ? parseTxBody(txBody) : [];
  const hasText = paragraphs.some((p) => p.runs.some((r) => r.text && r.text.length > 0));

  const fill = parseFill(spPr);
  const border = parseBorder(spPr);

  const prstGeom = spPr['a:prstGeom']?.['@_prst'];

  // Padding from bodyPr (insets in EMU)
  const bodyPr = txBody?.['a:bodyPr'] || {};
  const padPt = {
    top: bodyPr['@_tIns'] != null ? Number(bodyPr['@_tIns']) / 12700 : 3.6,
    right: bodyPr['@_rIns'] != null ? Number(bodyPr['@_rIns']) / 12700 : 7.2,
    bottom: bodyPr['@_bIns'] != null ? Number(bodyPr['@_bIns']) / 12700 : 3.6,
    left: bodyPr['@_lIns'] != null ? Number(bodyPr['@_lIns']) / 12700 : 7.2,
  };
  const anchorMap: Record<string, 'top' | 'middle' | 'bottom'> = {
    t: 'top', ctr: 'middle', b: 'bottom',
  };
  const vAlign = anchorMap[bodyPr['@_anchor'] as string] || 'top';

  if (hasText) {
    const el: IRTextElement = {
      type: 'text',
      x, y, w, h, rotation, zIndex,
      paragraphs,
      fill,
      border,
      paddingPt: padPt,
      vAlign,
    };
    return el;
  }

  // Pure shape (no text)
  if (fill || border) {
    const el: IRShapeElement = {
      type: 'shape',
      x, y, w, h, rotation, zIndex,
      fill, border, prstGeom,
    };
    return el;
  }

  return null;
}

function parsePic(pic: any, zIndex: number, rels: Rels): IRImageElement | null {
  const spPr = pic['p:spPr'] || {};
  const { x, y, w, h, rotation } = parseXfrm(spPr);
  if (w <= 0 || h <= 0) return null;

  const blip = pic['p:blipFill']?.['a:blip'];
  const embedId = blip?.['@_r:embed'] || blip?.['@_embed'];
  if (!embedId) return null;

  const rel = rels[embedId];
  if (!rel) return null;

  // rel.target is like ../media/image-16-1.png — we flatten everything to
  // the basename so the IR src matches the asset key we write later.
  const relPath = path.basename(rel.target);
  const ext = path.extname(relPath).toLowerCase().replace('.', '');
  const mimeType =
    ext === 'svg' ? 'image/svg+xml' :
    ext === 'webp' ? 'image/webp' :
    ext === 'gif' ? 'image/gif' :
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
    'image/png';

  return {
    type: 'image',
    x, y, w, h, rotation, zIndex,
    src: relPath,
    mimeType,
  };
}

function parseGraphicFrame(gf: any, zIndex: number): IRElement | null {
  const xfrm = gf['p:xfrm'];
  const off = xfrm?.['a:off'];
  const ext = xfrm?.['a:ext'];
  const x = emu(off?.['@_x']);
  const y = emu(off?.['@_y']);
  const w = emu(ext?.['@_cx']);
  const h = emu(ext?.['@_cy']);
  if (w <= 0 || h <= 0) return null;

  const tbl = gf['a:graphic']?.['a:graphicData']?.['a:tbl'];
  if (!tbl) return null;

  const grid = arr(tbl['a:tblGrid']?.['a:gridCol']);
  const colWidths = grid.map((g) => emu(g['@_w']));

  const rows: IRTableElement['rows'] = arr(tbl['a:tr']).map((tr) => {
    const cells: IRTableCell[] = arr(tr['a:tc']).map((tc) => {
      const txBody = tc['a:txBody'];
      const tcPr = tc['a:tcPr'] || {};
      const fill = parseFill(tcPr);
      const anchorMap: Record<string, 'top' | 'middle' | 'bottom'> = {
        t: 'top', ctr: 'middle', b: 'bottom',
      };
      const vAlign = anchorMap[tcPr['@_anchor'] as string] || 'middle';
      return {
        paragraphs: txBody ? parseTxBody(txBody) : [],
        fill,
        vAlign,
        rowSpan: tc['@_rowSpan'] ? Number(tc['@_rowSpan']) : undefined,
        colSpan: tc['@_gridSpan'] ? Number(tc['@_gridSpan']) : undefined,
      };
    });
    return {
      height: tr['@_h'] ? emu(tr['@_h']) : undefined,
      cells,
    };
  });

  return {
    type: 'table',
    x, y, w, h, zIndex,
    rows,
    colWidths,
  };
}

function walkSpTree(spTree: any, rels: Rels, zCounter: { v: number }): IRElement[] {
  const out: IRElement[] = [];

  for (const sp of arr(spTree['p:sp'])) {
    const el = parseShape(sp, zCounter.v++);
    if (el) out.push(el);
  }
  for (const pic of arr(spTree['p:pic'])) {
    const el = parsePic(pic, zCounter.v++, rels);
    if (el) out.push(el);
  }
  for (const gf of arr(spTree['p:graphicFrame'])) {
    const el = parseGraphicFrame(gf, zCounter.v++);
    if (el) out.push(el);
  }
  // Recurse into groups, with group offset applied
  for (const grp of arr(spTree['p:grpSp'])) {
    const grpSpPr = grp['p:grpSpPr'] || {};
    const xfrm = grpSpPr['a:xfrm'];
    const off = xfrm?.['a:off'];
    const chOff = xfrm?.['a:chOff'];
    const dx = emu(off?.['@_x']) - emu(chOff?.['@_x']);
    const dy = emu(off?.['@_y']) - emu(chOff?.['@_y']);
    const children = walkSpTree(grp, rels, zCounter);
    for (const c of children) {
      c.x += dx;
      c.y += dy;
    }
    out.push(...children);
  }

  return out;
}

function parseSlide(slideXml: string, rels: Rels, index: number): IRSlide {
  const doc = xml.parse(slideXml);
  const sld = doc['p:sld'];
  const cSld = sld['p:cSld'];
  const spTree = cSld['p:spTree'];

  let background: IRSlide['background'];
  const bg = cSld['p:bg'];
  if (bg) {
    const bgPr = bg['p:bgPr'];
    const color = bgPr ? srgbColor(bgPr) : undefined;
    if (color) background = { color };
  }

  const zCounter = { v: 0 };
  const elements = walkSpTree(spTree, rels, zCounter);

  return { index, background, elements };
}

export async function parsePptx(filePath: string): Promise<IRDeck> {
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);

  // Slide dimensions
  const presXml = await zip.file('ppt/presentation.xml')!.async('string');
  const presDoc = xml.parse(presXml);
  const sldSz = presDoc['p:presentation']?.['p:sldSz'];
  const slideWidth = emu(sldSz?.['@_cx']) || 10;
  const slideHeight = emu(sldSz?.['@_cy']) || 5.625;

  // Slide order from presentation rels
  const presRelsXml = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string');
  const presRels = parseRels(presRelsXml);

  const sldIdLst = arr(presDoc['p:presentation']?.['p:sldIdLst']?.['p:sldId']);
  const slidePaths: string[] = [];
  for (const sldId of sldIdLst) {
    const rId = sldId['@_r:id'] || sldId['@_id'];
    const rel = presRels[rId];
    if (!rel) continue;
    // rel.target is e.g. "slides/slide1.xml"
    slidePaths.push('ppt/' + rel.target.replace(/^\.\//, ''));
  }

  const slides: IRSlide[] = [];
  const assets = new Map<string, Buffer>();

  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i];
    const slideXml = await zip.file(slidePath)!.async('string');

    // Per-slide rels
    const relsPath = slidePath.replace('slides/', 'slides/_rels/') + '.rels';
    const relsFile = zip.file(relsPath);
    const rels: Rels = relsFile ? parseRels(await relsFile.async('string')) : {};

    const slide = parseSlide(slideXml, rels, i + 1);
    slides.push(slide);

    // Pull in referenced media files
    for (const rId of Object.keys(rels)) {
      const rel = rels[rId];
      if (!rel.type.includes('/image')) continue;
      const targetPath = 'ppt/' + rel.target.replace(/^\.\.\//, '');
      const mediaFile = zip.file(targetPath);
      if (!mediaFile) continue;
      const fileName = path.basename(targetPath);
      if (assets.has(fileName)) continue;
      const buf = await mediaFile.async('nodebuffer');
      assets.set(fileName, buf);
    }
  }

  return { slideWidth, slideHeight, slides, assets };
}
