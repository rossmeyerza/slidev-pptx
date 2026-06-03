#!/usr/bin/env node

import path from 'path';
import { verifyPptx } from './verifier.js';

function usage() {
  console.log(`
Usage: slidev-to-pptx-verify <output.pptx> [options]

Options:
  --slides <number>   Expected slide count
  --scale <number>    Expected screenshot scale (default: 2)
  --help              Show this help
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length < 1) {
    usage();
    process.exit(args.includes('--help') ? 0 : 1);
  }

  const pptxPath = args[0];
  let expectedSlides: number | undefined;
  let expectedScale = 2;

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--slides': {
        expectedSlides = Number(args[++i]);
        if (!Number.isInteger(expectedSlides) || expectedSlides < 1) {
          console.error('Invalid --slides value. Expected a positive integer.');
          process.exit(1);
        }
        break;
      }
      case '--scale': {
        expectedScale = Number(args[++i]);
        if (!Number.isFinite(expectedScale) || expectedScale < 1 || expectedScale > 4) {
          console.error('Invalid --scale value. Expected a number between 1 and 4.');
          process.exit(1);
        }
        break;
      }
    }
  }

  const result = await verifyPptx(path.resolve(pptxPath), {
    expectedSlides,
    expectedScale,
  });

  console.log('\n=== slidev-to-pptx verify ===\n');
  console.log(`PPTX:      ${path.resolve(pptxPath)}`);
  console.log(`Slides:    ${result.slideCount}`);
  console.log(`Images:    ${result.imageCount}`);
  console.log(`Image dim: ${result.expectedImageWidth}x${result.expectedImageHeight}`);

  if (!result.ok) {
    console.error('\nVerification failed:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log('\nVerification passed.');
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
