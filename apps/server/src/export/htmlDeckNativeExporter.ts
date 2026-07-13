import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';

export interface NativeExportResult {
  slideCount: number;
  verification: {
    ok: boolean;
    slideCount: number;
    textRuns: number;
    images: number;
    rects: number;
  };
}

export interface ExportNativePptxOptions {
  deckDir: string;
  shellDir: string;
  outputPath: string;
  signal?: AbortSignal;
}

interface NativeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface NativeRectNode {
  type: 'rect';
  box: NativeBox;
  bg: string | null;
  border: { w: number; color: string } | null;
  gradient: boolean;
}

interface NativeImageNode {
  type: 'image';
  box: NativeBox;
  nx: number;
}

interface NativeTextNode {
  type: 'text';
  box: NativeBox;
  text: string;
  font: string;
  sizePx: number;
  color: string;
  weight: string;
  italic: boolean;
  align: string;
  lh: number;
}

type NativeIrNode = NativeRectNode | NativeImageNode | NativeTextNode;

interface NativeSlideIr {
  nodes: NativeIrNode[];
}

const SHELL_FILES = new Set(['index.html', 'runtime.js', 'runtime.css']);
const DENIED_BASENAMES = new Set(['meta.json', 'package.json', 'package-lock.json']);
const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const SLIDE_WIDTH_IN = 10;
const SLIDE_HEIGHT_IN = 5.625;
const SCALE_X = SLIDE_WIDTH_IN / SLIDE_WIDTH;
const SCALE_Y = SLIDE_HEIGHT_IN / SLIDE_HEIGHT;

export async function exportNativePptx(options: ExportNativePptxOptions): Promise<NativeExportResult> {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' });
        res.end('Method not allowed');
        return;
      }
      const requestPath = runtimeRequestPath(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      if (!isAllowedRuntimeAsset(requestPath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const root = SHELL_FILES.has(requestPath) ? options.shellDir : options.deckDir;
      const filePath = safeStaticPath(root, requestPath);
      const data = await fs.readFile(filePath);
      res.writeHead(200, { 'content-type': contentType(filePath) });
      res.end(data);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
      res.writeHead(code === 'ENOENT' ? 404 : 500);
      res.end(code === 'ENOENT' ? 'Not found' : 'Export server error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const abort = () => { void browser?.close(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not determine export server address');

    browser = await chromium.launch({ headless: true });
    options.signal?.throwIfAborted();
    const context = await browser.newContext({
      viewport: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const deck = (window as unknown as { __deck?: { count?: number } }).__deck;
      return Boolean(deck && typeof deck.count === 'number' && deck.count > 0);
    }, undefined, { timeout: 15_000 });

    const slideCount = await page.evaluate(() => (window as unknown as { __deck: { count: number } }).__deck.count);
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'HTML_DECK', width: SLIDE_WIDTH_IN, height: SLIDE_HEIGHT_IN });
    pptx.layout = 'HTML_DECK';
    const counts = { textRuns: 0, images: 0, rects: 0 };

    for (let slideNumber = 1; slideNumber <= slideCount; slideNumber += 1) {
      options.signal?.throwIfAborted();
      await page.evaluate((number) => (window as unknown as { __deck: { go: (slide: number) => void } }).__deck.go(number), slideNumber);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map((image) => image.complete ? image.decode().catch(() => undefined) : new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        })));
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      const ir: NativeSlideIr = await page.evaluate(() => {
        const slidesAll = [...document.querySelectorAll('.deck-stage .slide')];
        const stage = document.querySelector('.deck-stage .slide.is-active')
          || slidesAll.find((slide) => getComputedStyle(slide).display !== 'none')
          || document.querySelector('.deck-stage')
          || document.body;
        const stageRect = stage.getBoundingClientRect();
        const nodes: NativeIrNode[] = [];
        const relativeBox = (rect: DOMRect): NativeBox => ({
          x: rect.left - stageRect.left,
          y: rect.top - stageRect.top,
          w: rect.width,
          h: rect.height,
        });
        const visible = (style: CSSStyleDeclaration): boolean => style.display !== 'none'
          && style.visibility !== 'hidden'
          && parseFloat(style.opacity) > 0.01;

        stage.querySelectorAll('*').forEach((element) => {
          const style = getComputedStyle(element);
          if (!visible(style) || element.classList.contains('click-hidden')) return;
          const rect = element.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return;
          const box = relativeBox(rect);
          const tag = element.tagName.toLowerCase();
          if (tag === 'img' || tag === 'svg') {
            const browserWindow = window as unknown as { __nx?: number };
            browserWindow.__nx = (browserWindow.__nx || 0) + 1;
            element.setAttribute('data-nx', String(browserWindow.__nx));
            nodes.push({ type: 'image', box, nx: browserWindow.__nx });
            return;
          }

          const background = style.backgroundColor;
          const borderWidth = parseFloat(style.borderTopWidth) || 0;
          const backgroundImage = Boolean(style.backgroundImage && style.backgroundImage !== 'none');
          if ((background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') || borderWidth > 0 || backgroundImage) {
            nodes.push({
              type: 'rect',
              box,
              bg: background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent' ? background : null,
              border: borderWidth > 0 ? { w: borderWidth, color: style.borderTopColor } : null,
              gradient: backgroundImage,
            });
          }

          // Per text-node Range rects keep inline sibling elements in separate,
          // tightly measured boxes.
          element.childNodes.forEach((child) => {
            if (child.nodeType !== Node.TEXT_NODE) return;
            const textNode = child as Text;
            const raw = (textNode.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (!raw) return;
            const range = document.createRange();
            range.selectNodeContents(textNode);
            const rangeRect = range.getBoundingClientRect();
            if (rangeRect.width < 1 || rangeRect.height < 1) return;
            nodes.push({
              type: 'text',
              box: relativeBox(rangeRect),
              text: raw,
              font: style.fontFamily,
              sizePx: parseFloat(style.fontSize),
              color: style.color,
              weight: style.fontWeight,
              italic: style.fontStyle === 'italic',
              align: style.textAlign,
              lh: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2,
            });
          });
        });
        return { nodes };
      });

      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      for (const node of ir.nodes) {
        options.signal?.throwIfAborted();
        const position = {
          x: inches(node.box.x, SCALE_X),
          y: inches(node.box.y, SCALE_Y),
          w: inches(node.box.w, SCALE_X),
          h: inches(node.box.h, SCALE_Y),
        };
        if (node.type === 'rect') {
          const fill = rgbToHex(node.bg);
          const line = node.border ? { color: rgbToHex(node.border.color) || '000000', width: node.border.w * 0.75 } : undefined;
          if (!fill && !line) continue;
          slide.addShape('rect', {
            ...position,
            fill: fill ? { color: fill } : { type: 'none' },
            line: line || { type: 'none' },
          });
          counts.rects += 1;
        } else if (node.type === 'image') {
          try {
            const image = await page.locator(`[data-nx="${node.nx}"]`).screenshot({ type: 'png' });
            slide.addImage({ data: `data:image/png;base64,${image.toString('base64')}`, ...position });
            counts.images += 1;
          } catch {
            // A disappearing image is non-fatal; other editable elements remain useful.
          }
        } else {
          const fontFace = (node.font || '').split(',')[0].replace(/["']/g, '').trim() || 'Arial';
          const lineSpacingMultiple = Math.min(2, Math.max(0.8, (node.lh || node.sizePx * 1.2) / node.sizePx));
          const align = node.align === 'center' || node.align === 'right' ? node.align : 'left';
          slide.addText(node.text, {
            ...position,
            fontFace,
            fontSize: points(node.sizePx),
            color: rgbToHex(node.color) || '000000',
            bold: Number(node.weight) >= 600,
            italic: node.italic,
            align,
            valign: 'top',
            margin: 0,
            wrap: true,
            fit: 'shrink',
            lineSpacingMultiple,
          });
          counts.textRuns += 1;
        }
      }
    }

    await pptx.writeFile({ fileName: options.outputPath });
    return {
      slideCount,
      verification: {
        ok: slideCount > 0 && counts.textRuns > 0,
        slideCount,
        ...counts,
      },
    };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await browser?.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function inches(pixels: number, scale: number): number {
  return Math.max(0, pixels * scale);
}

function points(pixels: number): number {
  return +(pixels * 0.75).toFixed(1);
}

function rgbToHex(color: string | null): string | null {
  if (!color) return null;
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => parseFloat(part));
  const alpha = parts[3] === undefined ? 1 : parts[3];
  if (alpha === 0) return null;
  return [parts[0], parts[1], parts[2]]
    .map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0'))
    .join('');
}

function runtimeRequestPath(requestPath: string): string {
  const decoded = decodeURIComponent(requestPath || '/').replace(/^\/+/, '');
  if (!decoded || decoded.endsWith('/')) return 'index.html';
  if (!path.posix.extname(decoded)) return 'index.html';
  return decoded;
}

function isAllowedRuntimeAsset(requestPath: string): boolean {
  const normalized = path.posix.normalize(requestPath);
  if (normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) return false;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment.startsWith('.'))) return false;
  if (segments.includes('node_modules') || segments.includes('dist')) return false;
  return !DENIED_BASENAMES.has(path.posix.basename(normalized));
}

function safeStaticPath(root: string, requestPath: string): string {
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, requestPath);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) throw new Error('Invalid static path');
  return resolved;
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}
