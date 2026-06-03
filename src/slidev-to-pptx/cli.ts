#!/usr/bin/env node

import { SlidevServer } from './server.js';
import { DOMExtractor } from './extractor.js';
import { classifyNodes, setFontMappingMode, FontMappingMode } from './classifier.js';
import { generatePptx } from './generator.js';
import { IRDeck, IRSlide } from './types.js';
import path from 'path';

const SLIDE_W_IN = 10;
const SLIDE_H_IN = 5.625;
type RenderMode = 'screenshot' | 'editable' | 'hybrid';

function usage() {
  console.log(`
Usage: slidev-to-pptx <deck.md> <output.pptx> [options]

Options:
  --port <number>     Slidev dev server port (default: 3045)
  --timeout <ms>      Server startup timeout (default: 30000)
  --url <url>         Use existing Slidev server URL instead of starting one
  --slides <range>    Slide range, e.g. "1-5" or "1,3,5" (default: all)
  --mode <mode>       Render mode: screenshot, editable, or hybrid (default: screenshot)
  --scale <number>    Screenshot render scale for screenshot/hybrid modes (default: 2)
  --font-mode <mode>  Font handling: exact or safe (default: exact)
  --fallback          Alias for --mode hybrid
  --debug             Enable debug output
  --help              Show this help
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length < 2) {
    usage();
    process.exit(args.includes('--help') ? 0 : 1);
  }

  // Parse args
  const deckPath = args[0];
  const outputPath = args[1];
  let port = 3045;
  let timeout = 30000;
  let existingUrl = '';
  let slideRange = '';
  let renderMode: RenderMode = 'screenshot';
  let screenshotScale = 2;
  let fontMode: FontMappingMode = 'exact';

  for (let i = 2; i < args.length; i++) {
    switch (args[i]) {
      case '--port': {
        port = parseInt(args[++i]);
        if (Number.isNaN(port)) {
          console.error('Invalid --port value. Expected a number.');
          process.exit(1);
        }
        break;
      }
      case '--timeout': {
        timeout = parseInt(args[++i]);
        if (Number.isNaN(timeout)) {
          console.error('Invalid --timeout value. Expected a number of milliseconds.');
          process.exit(1);
        }
        break;
      }
      case '--url': existingUrl = args[++i]; break;
      case '--slides': slideRange = args[++i]; break;
      case '--mode': {
        const value = (args[++i] || '').toLowerCase();
        if (value !== 'screenshot' && value !== 'editable' && value !== 'hybrid') {
          console.error('Invalid --mode value. Expected "screenshot", "editable", or "hybrid".');
          process.exit(1);
        }
        renderMode = value as RenderMode;
        break;
      }
      case '--scale': {
        screenshotScale = Number(args[++i]);
        if (!Number.isFinite(screenshotScale) || screenshotScale < 1 || screenshotScale > 4) {
          console.error('Invalid --scale value. Expected a number between 1 and 4.');
          process.exit(1);
        }
        break;
      }
      case '--font-mode': {
        const value = (args[++i] || '').toLowerCase();
        if (value !== 'exact' && value !== 'safe') {
          console.error('Invalid --font-mode value. Expected "exact" or "safe".');
          process.exit(1);
        }
        fontMode = value as FontMappingMode;
        break;
      }
      case '--fallback': renderMode = 'hybrid'; break;
      case '--debug': process.env.DEBUG = '1'; break;
    }
  }

  console.log('\n=== slidev-to-pptx ===\n');
  console.log(`Deck:   ${deckPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Mode:   ${renderMode}`);
  console.log(`Scale:  ${screenshotScale}`);
  console.log(`Fonts:  ${fontMode}`);

  setFontMappingMode(fontMode);

  // Step 1: Start or connect to Slidev server
  let server: SlidevServer | null = null;
  let baseUrl: string;

  if (existingUrl) {
    baseUrl = existingUrl.replace(/\/$/, '');
    console.log(`Using existing server: ${baseUrl}`);
  } else {
    const resolvedDeck = path.resolve(deckPath);
    server = new SlidevServer({ deckPath: resolvedDeck, port, timeout });
    baseUrl = await server.start();
  }

  // Step 2: Init browser
  const extractor = new DOMExtractor();
  await extractor.init(screenshotScale);

  // Step 3: Register signal handlers for clean shutdown
  const shutdown = () => {
    console.log('\nReceived shutdown signal, cleaning up...');
    extractor.close().catch(() => {});
    if (server) server.stop();
    process.exit(1);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    // Step 4: Determine slide count
    console.log('\nDetecting slides...');
    const totalSlides = await extractor.getSlideCount(baseUrl);
    console.log(`Found ${totalSlides} slides`);

    if (totalSlides === 0) {
      throw new Error('No slides detected. Is the Slidev server running?');
    }

    // Parse slide range
    const slideIndices = parseSlideRange(slideRange, totalSlides);
    console.log(`Processing slides: ${slideIndices.join(', ')}`);

    // Step 5: Extract and classify each slide
    const deck: IRDeck = {
      slideWidth: SLIDE_W_IN,
      slideHeight: SLIDE_H_IN,
      slides: [],
    };

    for (const idx of slideIndices) {
      console.log(`\nSlide ${idx}/${totalSlides}:`);

      if (renderMode === 'screenshot') {
        console.log('  Capturing slide screenshot...');
        const screenshot = await extractor.screenshotSlide(baseUrl, idx);
        deck.slides.push(createScreenshotSlide(idx, screenshot));
        continue;
      }

      // Extract DOM
      console.log('  Extracting DOM...');
      const extractedSlide = await extractor.extractSlide(baseUrl, idx);
      const nodes = extractedSlide.nodes;
      console.log(`  Found ${nodes.length} top-level nodes`);

      // Classify into IR elements
      console.log('  Classifying elements...');
      const elements = classifyNodes(nodes);
      const textCount = elements.filter(e => e.type === 'text').length;
      const imageCount = elements.filter(e => e.type === 'image').length;
      const shapeCount = elements.filter(e => e.type === 'shape').length;
      const tableCount = elements.filter(e => e.type === 'table').length;
      console.log(`  Classified ${elements.length} elements (${textCount} text, ${imageCount} images, ${shapeCount} shapes, ${tableCount} tables)`);

      const hasSvgImage = elements.some(e => e.type === 'image' && !!(e as any).src && ((e as any).src.startsWith('data:image/svg+xml') || /\.svg(\?|#|$)/i.test((e as any).src)));
      // Smarter fallback: trigger when elements is empty but nodes had content
      const hasContentButNothingClassified = elements.length === 0 && nodes.length > 3;
      const shouldFallback = hasContentButNothingClassified || hasSvgImage;

      // If fallback conditions met in hybrid mode, screenshot the whole slide
      if (renderMode === 'hybrid' && shouldFallback) {
        console.log('  Complex content detected, capturing fallback screenshot...');
        const screenshot = await extractor.screenshotSlide(baseUrl, idx);
        deck.slides.push(createScreenshotSlide(idx, screenshot, extractedSlide.backgroundColor));
      } else {
        const irSlide: IRSlide = {
          index: idx,
          backgroundColor: extractedSlide.backgroundColor,
          backgroundImage: extractedSlide.backgroundImage,
          elements,
        };
        deck.slides.push(irSlide);
      }
    }

    // Step 6: Generate PPTX
    console.log('\nGenerating PPTX...');
    await generatePptx(deck, path.resolve(outputPath));
    console.log('\nDone!');

  } finally {
    // Clean up signal handlers so they don't interfere with normal exit
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);

    await extractor.close();
    if (server) server.stop();
  }
}

function createScreenshotSlide(index: number, screenshot: Buffer, backgroundColor?: string): IRSlide {
  return {
    index,
    backgroundColor,
    elements: [{
      type: 'image',
      src: `data:image/png;base64,${screenshot.toString('base64')}`,
      x: 0,
      y: 0,
      w: SLIDE_W_IN,
      h: SLIDE_H_IN,
      zIndex: 0,
    }],
  };
}

function parseSlideRange(range: string, total: number): number[] {
  if (!range) return Array.from({ length: total }, (_, i) => i + 1);

  const indices: number[] = [];
  for (const part of range.split(',')) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= Math.min(end, total); i++) {
          indices.push(i);
        }
      }
    } else {
      const n = parseInt(trimmed);
      if (n >= 1 && n <= total) indices.push(n);
    }
  }

  return [...new Set(indices)].sort((a, b) => a - b);
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
