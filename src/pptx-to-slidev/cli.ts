import * as path from 'path';
import * as fs from 'fs';
import { parsePptx } from './parser.js';
import { generateSlidev } from './generator.js';

function usage(exitCode = 1): never {
  console.error('Usage: pptx-to-slidev <input.pptx> [--out <dir>]');
  process.exit(exitCode);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  let input = '';
  let outDir = '';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out' || a === '-o') outDir = args[++i];
    else if (a === '--help' || a === '-h') usage(0);
    else if (!input) input = a;
  }

  if (!input) usage();
  if (!fs.existsSync(input)) {
    console.error(`Input file not found: ${input}`);
    process.exit(1);
  }

  if (!outDir) {
    const base = path.basename(input, path.extname(input));
    outDir = path.join(path.dirname(input), `${base}-slidev`);
  }

  console.log(`Parsing ${input}...`);
  const deck = await parsePptx(path.resolve(input));
  console.log(`  Slides: ${deck.slides.length}`);
  console.log(`  Canvas: ${deck.slideWidth}" × ${deck.slideHeight}"`);
  console.log(`  Assets: ${deck.assets.size}`);

  console.log(`Generating Slidev project in ${outDir}...`);
  await generateSlidev(deck, { outDir });

  console.log(`Done.`);
  console.log(`Next: cd ${outDir} && npm i && npm run dev`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
