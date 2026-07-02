#!/usr/bin/env node

import { SlidevServer } from './server.js';
import { DOMExtractor } from './extractor.js';
import { generatePptx } from './generator.js';
import { IRDeck, IRSlide } from './types.js';
import path from 'path';

const SLIDE_W_IN = 10;
const SLIDE_H_IN = 5.625;

function usage() {
  console.log(`
Usage: slidev-to-pptx <deck.md> <output.pptx> [options]

Options:
  --port <number>     Slidev dev server port (default: 3045)
  --timeout <ms>      Server startup timeout (default: 30000)
  --url <url>         Use existing Slidev server URL instead of starting one
  --slides <range>    Slide range, e.g. "1-5" or "1,3,5" (default: all)
  --scale <number>    Screenshot render scale (default: 2)
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
  let screenshotScale = 2;

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
        if (value !== 'screenshot') {
          console.error('Invalid --mode value. Only "screenshot" is supported.');
          process.exit(1);
        }
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
      case '--debug': process.env.DEBUG = '1'; break;
    }
  }

  console.log('\n=== slidev-to-pptx ===\n');
  console.log(`Deck:   ${deckPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Scale:  ${screenshotScale}`);

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

    // Step 5: Screenshot each slide
    const deck: IRDeck = {
      slideWidth: SLIDE_W_IN,
      slideHeight: SLIDE_H_IN,
      slides: [],
    };

    for (const idx of slideIndices) {
      console.log(`\nSlide ${idx}/${totalSlides}:`);
      console.log('  Capturing slide screenshot...');
      const screenshot = await extractor.screenshotSlide(baseUrl, idx);
      deck.slides.push(createScreenshotSlide(idx, screenshot));
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

function createScreenshotSlide(index: number, screenshot: Buffer): IRSlide {
  return {
    index,
    image: `data:image/png;base64,${screenshot.toString('base64')}`,
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
