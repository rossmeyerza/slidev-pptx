import fs from 'fs';
import JSZip from 'jszip';
import { imageSize } from 'image-size';
import { VerificationResult } from './types.js';

const SLIDE_WIDTH_EMU = 9144000;
const SLIDE_HEIGHT_EMU = 5143500;
const SLIDE_WIDTH_PX = 960;
const SLIDE_HEIGHT_PX = 540;

export interface VerifyPptxOptions {
  expectedSlides?: number;
  expectedScale?: number;
}

export async function verifyPptx(pptxPath: string, opts: VerifyPptxOptions = {}): Promise<VerificationResult> {
  const expectedScale = opts.expectedScale ?? 2;
  const expectedImageWidth = SLIDE_WIDTH_PX * expectedScale;
  const expectedImageHeight = SLIDE_HEIGHT_PX * expectedScale;
  const errors: string[] = [];

  if (!fs.existsSync(pptxPath)) {
    return {
      ok: false,
      slideCount: 0,
      imageCount: 0,
      expectedImageWidth,
      expectedImageHeight,
      errors: [`PPTX not found: ${pptxPath}`],
    };
  }

  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const imageNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/media\/image-\d+-1\.png$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  if (opts.expectedSlides !== undefined && slideNames.length !== opts.expectedSlides) {
    errors.push(`Expected ${opts.expectedSlides} slides, found ${slideNames.length}.`);
  }

  if (imageNames.length !== slideNames.length) {
    errors.push(`Expected one screenshot image per slide, found ${imageNames.length} images for ${slideNames.length} slides.`);
  }

  for (const slideName of slideNames) {
    const slideIndex = slideNumber(slideName);
    const xml = await zip.file(slideName)!.async('string');
    const imageCount = countMatches(xml, /<p:pic\b/g);

    if (imageCount !== 1) {
      errors.push(`Slide ${slideIndex}: expected exactly one full-slide image, found ${imageCount}.`);
    }

    if (!xml.includes('<a:off x="0" y="0"/>')) {
      errors.push(`Slide ${slideIndex}: image is not positioned at x=0,y=0.`);
    }

    if (!xml.includes(`<a:ext cx="${SLIDE_WIDTH_EMU}" cy="${SLIDE_HEIGHT_EMU}"/>`)) {
      errors.push(`Slide ${slideIndex}: image is not sized to ${SLIDE_WIDTH_EMU}x${SLIDE_HEIGHT_EMU} EMUs.`);
    }

    if (!xml.includes('<a:stretch><a:fillRect/></a:stretch>')) {
      errors.push(`Slide ${slideIndex}: image is not configured to stretch/fill the slide rectangle.`);
    }
  }

  for (const imageName of imageNames) {
    const imageIndex = slideNumber(imageName);
    const data = await zip.file(imageName)!.async('nodebuffer');
    const dimensions = imageSize(data);

    if (dimensions.width !== expectedImageWidth || dimensions.height !== expectedImageHeight) {
      errors.push(
        `Image ${imageIndex}: expected ${expectedImageWidth}x${expectedImageHeight}, found ${dimensions.width}x${dimensions.height}.`
      );
    }
  }

  return {
    ok: errors.length === 0,
    slideCount: slideNames.length,
    imageCount: imageNames.length,
    expectedImageWidth,
    expectedImageHeight,
    errors,
  };
}

function slideNumber(name: string): number {
  const match = name.match(/(?:slide|image-)(\d+)/);
  return match ? Number(match[1]) : 0;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}
