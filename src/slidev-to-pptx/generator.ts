import PptxGenJS from 'pptxgenjs';
import { IRDeck, IRSlide, IRElement, IRBaseElement, IRTableElement } from './types.js';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const MAX_REDIRECT_DEPTH = 5;

function colorToPptxHex(color?: string): string | undefined {
  if (!color) return undefined;

  const trimmed = color.trim();
  if (!trimmed || trimmed === 'transparent' || trimmed === 'rgba(0, 0, 0, 0)' || trimmed === 'rgba(0,0,0,0)') {
    return undefined;
  }

  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      return hex.split('').map((c) => c + c).join('').toUpperCase();
    }
    return hex.toUpperCase();
  }

  const match = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (match) {
    return [match[1], match[2], match[3]]
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  return undefined;
}

export async function generatePptx(deck: IRDeck, outputPath: string) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'SLIDEV', width: deck.slideWidth, height: deck.slideHeight });
  pptx.layout = 'SLIDEV';

  for (const irSlide of deck.slides) {
    console.log(`  Generating slide ${irSlide.index}... (${irSlide.elements.length} elements)`);
    const slide = pptx.addSlide();

    // Set actual slide background. Unset/transparent defaults to white.
    slide.background = { color: colorToPptxHex(irSlide.backgroundColor) || 'FFFFFF' };

    for (const el of irSlide.elements) {
      try {
        await addElement(slide, el);
      } catch (err: any) {
        console.warn(`    Warning: Failed to add element: ${err.message}`);
      }
    }
  }

  await pptx.writeFile({ fileName: outputPath });
  console.log(`\nPPTX saved to: ${outputPath}`);
}

async function addElement(slide: any, el: IRElement) {
  switch (el.type) {
    case 'text':
      addText(slide, el as IRBaseElement);
      break;
    case 'image':
      await addImage(slide, el as IRBaseElement);
      break;
    case 'shape':
      addShape(slide, el as IRBaseElement);
      break;
    case 'code-image':
      await addImage(slide, el as IRBaseElement);
      break;
    case 'table':
      addTable(slide, el as IRTableElement);
      break;
  }
}

function addText(slide: any, el: IRBaseElement) {
  if (!el.content || el.content.trim().length === 0) return;

  const pad = 0.02;
  const opts: any = {
    x: Math.max(0, el.x - pad),
    y: Math.max(0, el.y - pad),
    w: el.w + pad * 2,
    h: el.h + pad * 2,
    fontSize: el.fontSize || 12,
    bold: el.bold || false,
    italic: el.italic || false,
    color: colorToPptxHex(el.color) || '000000',
    align: el.align || 'left',
    fontFace: el.fontFamily || 'Arial',
    valign: 'top',
    wrap: true,
    fit: 'none',
    margin: 0,
  };

  if (el.lineHeight) {
    opts.lineSpacing = el.lineHeight;
  }

  const fillColor = colorToPptxHex(el.backgroundColor);
  if (fillColor) {
    opts.fill = { color: fillColor };
  }

  slide.addText(el.content, opts);
}

async function addImage(slide: any, el: IRBaseElement) {
  if (!el.src) return;

  let imageData: string | undefined;

  if (el.src.startsWith('data:')) {
    imageData = el.src;
  } else if (el.src.startsWith('file://') || el.src.startsWith('/')) {
    const filePath = el.src.replace('file://', '');
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const mime = ext === 'svg' ? 'image/svg+xml' :
                   ext === 'webp' ? 'image/webp' :
                   ext === 'png' ? 'image/png' : 'image/jpeg';
      const data = fs.readFileSync(filePath);
      imageData = `data:${mime};base64,${data.toString('base64')}`;
    }
  } else if (el.src.startsWith('http')) {
    try {
      const { data, mimeType } = await fetchImage(el.src);
      imageData = `data:${mimeType};base64,${data.toString('base64')}`;
    } catch (err: any) {
      console.warn(`    Skipping image (fetch failed): ${el.src}`);
      return;
    }
  }

  if (!imageData) {
    console.warn(`    Skipping image (no data): ${el.src}`);
    return;
  }

  try {
    slide.addImage({
      data: imageData,
      x: el.x,
      y: el.y,
      w: el.w,
      h: el.h,
    });
  } catch (err: any) {
    console.warn(`    Failed to embed image: ${err.message}`);
  }
}

function addShape(slide: any, el: IRBaseElement) {
  if (!el.backgroundColor && (!el.borderColor || !el.borderWidth)) return;

  const opts: any = {
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    rectRadius: el.borderRadius ? el.borderRadius / 96 : 0,
  };

  const fillColor = colorToPptxHex(el.backgroundColor);
  if (fillColor) {
    opts.fill = { color: fillColor };
  }

  const borderColor = colorToPptxHex(el.borderColor);
  if (borderColor && el.borderWidth && el.borderWidth > 0) {
    opts.line = {
      color: borderColor,
      width: Math.max(0.5, el.borderWidth * 0.75),
    };
  }

  slide.addShape('rect', opts);
}

function addTable(slide: any, el: IRTableElement) {
  if (!el.rows || el.rows.length === 0) return;

  // Build PptxGenJS table rows: each row is an array of cell objects
  const tableRows: any[][] = el.rows.map(row =>
    row.cells.map(cell => ({
      text: cell.text || '',
      options: {
        fontSize: el.fontSize || 10,
        bold: cell.bold || false,
        color: colorToPptxHex(cell.color) || '000000',
        align: cell.align || 'left',
        fontFace: el.fontFamily || 'Arial',
        valign: 'middle',
      },
    }))
  );

  slide.addTable(tableRows, {
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    border: { type: 'solid', pt: 0.5, color: 'CCCCCC' },
    margin: [2, 4, 2, 4],
    fontSize: el.fontSize || 10,
    fontFace: el.fontFamily || 'Arial',
  });
}

function fetchImage(url: string, depth = 0): Promise<{ data: Buffer; mimeType: string }> {
  if (depth >= MAX_REDIRECT_DEPTH) {
    return Promise.reject(new Error(`Too many redirects (max ${MAX_REDIRECT_DEPTH}): ${url}`));
  }

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        fetchImage(redirectUrl, depth + 1).then(resolve).catch(reject);
        return;
      }

      if (!res.statusCode) {
        reject(new Error(`Image request failed with no status code: ${url}`));
        return;
      }

      if (res.statusCode >= 400) {
        reject(new Error(`Image request failed with status ${res.statusCode}: ${url}`));
        return;
      }

      const contentType = res.headers['content-type'];
      const mimeType = Array.isArray(contentType) ? contentType[0] : contentType;
      if (!mimeType) {
        reject(new Error(`Image response missing Content-Type: ${url}`));
        return;
      }

      const normalizedMimeType = mimeType.split(';')[0].trim();
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ data: Buffer.concat(chunks), mimeType: normalizedMimeType }));
      res.on('error', reject);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Image request timed out: ${url}`));
    });
    req.on('error', reject);
  });
}
