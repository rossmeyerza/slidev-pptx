import PptxGenJS from 'pptxgenjs';
import { IRDeck } from './types.js';

export async function generatePptx(deck: IRDeck, outputPath: string) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'SLIDEV', width: deck.slideWidth, height: deck.slideHeight });
  pptx.layout = 'SLIDEV';

  for (const irSlide of deck.slides) {
    console.log(`  Generating slide ${irSlide.index}...`);
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addImage({
      data: irSlide.image,
      x: 0,
      y: 0,
      w: deck.slideWidth,
      h: deck.slideHeight,
    });
  }

  await pptx.writeFile({ fileName: outputPath });
  console.log(`\nPPTX saved to: ${outputPath}`);
}
