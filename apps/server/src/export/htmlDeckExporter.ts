import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { imageSize } from 'image-size';

export interface VerificationResult {
  ok: boolean;
  slideCount: number;
  imageCount: number;
  expectedImageWidth: number;
  expectedImageHeight: number;
  errors: string[];
}

export interface ExportHtmlDeckOptions {
  deckDir: string;
  shellDir: string;
  format: 'pptx' | 'pdf';
  outputPath: string;
  scale?: number;
  signal?: AbortSignal;
}

interface CaptureSlidePngsOptions {
  slides?: number[];
  scale?: number;
  signal?: AbortSignal;
  afterCapture?: (page: import('playwright').Page, screenshots: Buffer[]) => Promise<void>;
}

const SHELL_FILES = new Set(['index.html', 'runtime.js', 'runtime.css']);
const DENIED_BASENAMES = new Set(['meta.json', 'package.json', 'package-lock.json']);
const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const SLIDE_WIDTH_EMU = 9144000;
const SLIDE_HEIGHT_EMU = 5143500;

export async function exportHtmlDeck(options: ExportHtmlDeckOptions): Promise<{ slideCount: number; verification?: VerificationResult }> {
  const scale = options.scale ?? 2;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Export scale must be a positive number');

  const screenshots = await captureSlidePngs(options.deckDir, options.shellDir, {
    scale,
    signal: options.signal,
    afterCapture: options.format === 'pdf'
      ? (page, captured) => writePdf(page, captured, options.outputPath)
      : undefined,
  });
  const slideCount = screenshots.length;

  if (options.format === 'pptx') {
    await writePptx(screenshots, options.outputPath);
    const verification = await verifyPptx(options.outputPath, slideCount, scale);
    if (!verification.ok) throw new Error(`PPTX verification failed: ${verification.errors.join(' ')}`);
    return { slideCount, verification };
  }

  const pdf = await fs.readFile(options.outputPath);
  if (!pdf.length) throw new Error('PDF export is empty');
  const pageMarkers = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  if (pageMarkers < slideCount) throw new Error(`PDF sanity check failed: expected at least ${slideCount} pages, found ${pageMarkers}`);
  return { slideCount };
}

export async function generateThumbnail(deckDir: string, shellDir: string, outputPath: string): Promise<void> {
  const [thumbnail] = await captureSlidePngs(deckDir, shellDir, { slides: [1], scale: 1 });
  if (!thumbnail) throw new Error('Could not capture scaffold thumbnail');
  await fs.writeFile(outputPath, thumbnail);
}

async function captureSlidePngs(deckDir: string, shellDir: string, options: CaptureSlidePngsOptions = {}): Promise<Buffer[]> {
  const scale = options.scale ?? 2;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Capture scale must be a positive number');

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
      const root = SHELL_FILES.has(requestPath) ? shellDir : deckDir;
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
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const deck = (window as unknown as { __deck?: { count?: number } }).__deck;
      return Boolean(deck && typeof deck.count === 'number' && deck.count > 0);
    }, undefined, { timeout: 15_000 });

    const slideCount = await page.evaluate(() => (window as unknown as { __deck: { count: number } }).__deck.count);
    const slideNumbers = options.slides ?? Array.from({ length: slideCount }, (_, index) => index + 1);
    for (const slideNumber of slideNumbers) {
      if (!Number.isInteger(slideNumber) || slideNumber < 1 || slideNumber > slideCount) {
        throw new Error(`Slide ${slideNumber} is outside the deck range 1-${slideCount}`);
      }
    }
    const screenshots: Buffer[] = [];
    for (const slideNumber of slideNumbers) {
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
      const stage = page.locator('.deck-stage');
      if (await stage.count() !== 1) throw new Error(`Expected one .deck-stage element on slide ${slideNumber}`);
      screenshots.push(await stage.screenshot({ type: 'png' }));
    }
    await options.afterCapture?.(page, screenshots);
    return screenshots;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await browser?.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function writePptx(screenshots: Buffer[], outputPath: string): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'HTML_DECK', width: 10, height: 5.625 });
  pptx.layout = 'HTML_DECK';
  for (const screenshot of screenshots) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addImage({ data: `data:image/png;base64,${screenshot.toString('base64')}`, x: 0, y: 0, w: 10, h: 5.625 });
  }
  await pptx.writeFile({ fileName: outputPath });
}

async function writePdf(page: import('playwright').Page, screenshots: Buffer[], outputPath: string): Promise<void> {
  const images = screenshots.map((screenshot) => `<img src="data:image/png;base64,${screenshot.toString('base64')}" alt="">`).join('');
  await page.setContent(`<!doctype html><html><head><style>@page{size:1280px 720px;margin:0}html,body{margin:0;padding:0}img{display:block;width:1280px;height:720px;break-after:page}img:last-child{break-after:auto}</style></head><body>${images}</body></html>`, { waitUntil: 'load' });
  await page.pdf({ path: outputPath, width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
}

async function verifyPptx(outputPath: string, expectedSlides: number, scale: number): Promise<VerificationResult> {
  const expectedImageWidth = SLIDE_WIDTH * scale;
  const expectedImageHeight = SLIDE_HEIGHT * scale;
  const errors: string[] = [];
  const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort(numericSort);
  const imageNames = Object.keys(zip.files).filter((name) => /^ppt\/media\/.*\.(png|jpe?g)$/i.test(name)).sort();
  if (slideNames.length !== expectedSlides) errors.push(`Expected ${expectedSlides} slides, found ${slideNames.length}.`);
  if (imageNames.length !== slideNames.length) errors.push(`Expected one image per slide, found ${imageNames.length} images for ${slideNames.length} slides.`);
  for (const [index, slideName] of slideNames.entries()) {
    const xml = await zip.file(slideName)!.async('string');
    const pictures = xml.match(/<p:pic\b/g)?.length ?? 0;
    if (pictures !== 1) errors.push(`Slide ${index + 1}: expected exactly one image, found ${pictures}.`);
    if (!xml.includes('<a:off x="0" y="0"/>')) errors.push(`Slide ${index + 1}: image offset is not 0,0.`);
    if (!xml.includes(`<a:ext cx="${SLIDE_WIDTH_EMU}" cy="${SLIDE_HEIGHT_EMU}"/>`)) errors.push(`Slide ${index + 1}: image extent is not ${SLIDE_WIDTH_EMU}x${SLIDE_HEIGHT_EMU}.`);
  }
  for (const [index, imageName] of imageNames.entries()) {
    const dimensions = imageSize(await zip.file(imageName)!.async('nodebuffer'));
    if (dimensions.width !== expectedImageWidth || dimensions.height !== expectedImageHeight) {
      errors.push(`Image ${index + 1}: expected ${expectedImageWidth}x${expectedImageHeight}, found ${dimensions.width}x${dimensions.height}.`);
    }
  }
  return { ok: errors.length === 0, slideCount: slideNames.length, imageCount: imageNames.length, expectedImageWidth, expectedImageHeight, errors };
}

function numericSort(left: string, right: string): number {
  return Number(left.match(/(\d+)/)?.[1] ?? 0) - Number(right.match(/(\d+)/)?.[1] ?? 0);
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
