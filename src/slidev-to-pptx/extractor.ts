import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { DOMNode, ExtractedSlide } from './types.js';

const VIEWPORT = { width: 960, height: 540 };
const WAIT_TIMEOUT = 8000;

/**
 * Wait until the target slide element exists, has non-zero dimensions,
 * and has no ongoing CSS transitions on the container.
 */
async function waitForSlideReady(page: Page, slideIndex: number, timeout = WAIT_TIMEOUT): Promise<void> {
  await page.waitForFunction(
    (idx: number) => {
      const el = document.querySelector(`.slidev-page-${idx}`);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 100 || rect.height <= 100) return false;
      // Check no running transitions on the container
      const style = window.getComputedStyle(el);
      const running = style.getPropertyValue('transition');
      // If transition is 'all 0s' or 'none' it's settled
      if (running && running !== 'none' && !running.includes('0s')) {
        // Check transitionend hasn't fired yet by looking at opacity/transform stability
        // Heuristic: if opacity is between 0 and 1, still transitioning
        const opacity = parseFloat(style.opacity || '1');
        if (opacity > 0 && opacity < 1) return false;
      }
      return true;
    },
    slideIndex,
    { timeout }
  ).catch(() => {
    // Ceiling timeout hit, proceed anyway
  });
}

async function prepareSlide(page: Page, baseUrl: string, slideIndex: number): Promise<void> {
  await page.goto(`${baseUrl}/${slideIndex}`, { waitUntil: 'networkidle' });
  await waitForSlideReady(page, slideIndex);

  await page.evaluate(async (idx) => {
    if (!document.getElementById('__slidev_to_pptx_static_capture__')) {
      const style = document.createElement('style');
      style.id = '__slidev_to_pptx_static_capture__';
      style.textContent = `
        *, *::before, *::after {
          animation-delay: 0s !important;
          animation-duration: 0s !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-delay: 0s !important;
          transition-duration: 0s !important;
        }
      `;
      document.head.appendChild(style);
    }

    const nav = (window as any).__slidev__?.nav;
    if (nav && typeof nav.go === 'function') {
      const clicksTotal = Number(nav.clicksTotal ?? nav.totalClicks ?? 9999);
      nav.go(idx, Number.isFinite(clicksTotal) ? clicksTotal : 9999);
    }

    await (document as any).fonts?.ready;

    const images = Array.from(document.images);
    await Promise.all(images.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      if (typeof img.decode === 'function') {
        return img.decode().catch(() => undefined);
      }
      return new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
    }));

    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, slideIndex).catch(() => {});

  await waitForSlideReady(page, slideIndex);
}

export class DOMExtractor {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async init(deviceScaleFactor = 1) {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor,
    });
    this.page = await this.context.newPage();
  }

  async getSlideCount(baseUrl: string): Promise<number> {
    const page = this.page!;
    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    // Wait for at least one .slidev-page element to appear
    await page.waitForFunction(
      () => {
        const nav = (window as any).__slidev__?.nav;
        if (nav?.total) return true;
        return document.querySelectorAll('.slidev-page').length > 0;
      },
      undefined,
      { timeout: WAIT_TIMEOUT }
    ).catch(() => {});

    // Try to detect slide count from Slidev's internal state
    const count = await page.evaluate(() => {
      const nav = (window as any).__slidev__?.nav;
      if (nav?.total) return nav.total;
      const pages = document.querySelectorAll('.slidev-page');
      if (pages.length > 0) return pages.length;
      return 0;
    });

    if (count > 0) return count;

    // Brute force: try navigating to slides until 404
    let n = 1;
    while (n < 200) {
      const resp = await page.goto(`${baseUrl}/${n}`, { waitUntil: 'domcontentloaded' });
      if (!resp || resp.status() >= 400) break;
      const hasContent = await page.evaluate(() => {
        return document.querySelector('.slidev-page') !== null ||
               document.querySelector('.slidev-layout') !== null;
      });
      if (!hasContent) break;
      n++;
    }
    return n - 1;
  }

  async extractSlide(baseUrl: string, slideIndex: number): Promise<ExtractedSlide> {
    const page = this.page!;

    await prepareSlide(page, baseUrl, slideIndex);

    // Wait for the slide layout to be present
    try {
      await page.waitForSelector('.slidev-layout', { timeout: 5000 });
    } catch {
      // Fallback: already waited above
    }

    // Extract DOM tree from the slide container
    await page.evaluate((idx) => { (window as any).__SLIDE_INDEX__ = idx; }, slideIndex);
    const nodes = await page.evaluate(() => {
      function isVisible(el: Element): boolean {
        const style = window.getComputedStyle(el);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (parseFloat(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return true;
      }

      function extractNode(el: Element, containerRect: DOMRect): any {
        if (!isVisible(el)) return null;

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const tag = el.tagName.toLowerCase();

        if (['script', 'style', 'noscript', 'link', 'meta'].includes(tag)) return null;

        let directText = '';
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            directText += child.textContent || '';
          }
        }
        directText = directText.trim();

        let imageSrc: string | undefined;
        if (tag === 'img') {
          imageSrc = (el as HTMLImageElement).src;
        }
        if (!imageSrc && tag === 'svg') {
          const svgEl = el as SVGSVGElement;
          if (!svgEl.getAttribute('xmlns')) {
            svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          }
          const serialized = new XMLSerializer().serializeToString(svgEl);
          imageSrc = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(serialized)))}`;
        }
        if (!imageSrc && style.backgroundImage && style.backgroundImage !== 'none') {
          const match = style.backgroundImage.match(/url\((['"]?)([\s\S]*?)\1\)/);
          if (match) imageSrc = match[2];
        }

        const childElements = Array.from(el.children).filter(c =>
          !['script', 'style', 'noscript'].includes(c.tagName.toLowerCase())
        );
        const isLeaf = childElements.length === 0 || (directText.length > 0 && childElements.length === 0);

        const children: any[] = [];
        for (const child of childElements) {
          const extracted = extractNode(child, containerRect);
          if (extracted) children.push(extracted);
        }

        const fullText = el.textContent?.trim() || '';
        const alwaysFullText = ['pre', 'code', 'td', 'th'];
        const extractedText = alwaysFullText.includes(tag) ? fullText : (directText || (isLeaf ? fullText : ''));

        return {
          tag,
          text: extractedText,
          html: el.outerHTML.substring(0, 500),
          x: rect.left - containerRect.left,
          y: rect.top - containerRect.top,
          width: rect.width,
          height: rect.height,
          zIndex: parseInt(style.zIndex) || 0,
          isVisible: true,
          isLeaf,
          imageSrc,
          styles: {
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
            fontFamily: style.fontFamily,
            color: style.color,
            backgroundColor: style.backgroundColor,
            textAlign: style.textAlign,
            textDecoration: style.textDecoration,
            display: style.display,
            position: style.position,
            lineHeight: style.lineHeight,
            borderRadius: style.borderRadius,
            borderColor: style.borderColor,
            borderWidth: style.borderWidth,
          },
          children,
        };
      }

      const slideIndex = (window as any).__SLIDE_INDEX__;
      const allPages = document.querySelectorAll('.slidev-page');
      let container: Element | null = null;

      for (const page of allPages) {
        if (page.classList.contains(`slidev-page-${slideIndex}`)) {
          container = page;
          break;
        }
      }

      if (!container || container.getBoundingClientRect().width === 0) {
        for (const page of allPages) {
          const rect = page.getBoundingClientRect();
          if (rect.width > 100 && rect.height > 100) {
            container = page;
            break;
          }
        }
      }

      if (!container) return { nodes: [] };

      const layout = container.querySelector('.slidev-layout');
      const target = (layout && layout.getBoundingClientRect().width > 100) ? layout : container;
      const finalRect = target.getBoundingClientRect();
      const targetStyle = window.getComputedStyle(target);

      const normalizeBackgroundColor = (color: string | null | undefined) => {
        if (!color) return undefined;
        if (color === 'transparent') return undefined;
        if (color === 'rgba(0, 0, 0, 0)' || color === 'rgba(0,0,0,0)') return undefined;
        return color;
      };

      const result: any[] = [];
      for (const child of target.children) {
        const node = extractNode(child, finalRect);
        if (node) result.push(node);
      }

      return {
        nodes: result,
        backgroundColor: normalizeBackgroundColor(targetStyle.backgroundColor),
        backgroundImage: targetStyle.backgroundImage && targetStyle.backgroundImage !== 'none'
          ? targetStyle.backgroundImage
          : undefined,
      };
    });

    return nodes as ExtractedSlide;
  }

  async screenshotElement(baseUrl: string, slideIndex: number, selector: string): Promise<Buffer> {
    const page = this.page!;
    await prepareSlide(page, baseUrl, slideIndex);

    const el = await page.$(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    return await el.screenshot({ type: 'png' }) as Buffer;
  }

  async screenshotSlide(baseUrl: string, slideIndex: number): Promise<Buffer> {
    const page = this.page!;
    await prepareSlide(page, baseUrl, slideIndex);

    const slideHandle = await page.evaluateHandle((idx) => {
      const pages = Array.from(document.querySelectorAll('.slidev-page'));
      return pages.find((page) => page.classList.contains(`slidev-page-${idx}`))
        || pages.find((page) => {
          const rect = page.getBoundingClientRect();
          return rect.width > 100 && rect.height > 100;
        })
        || document.querySelector('.slidev-layout')
        || document.body;
    }, slideIndex);

    const element = slideHandle.asElement();
    if (!element) {
      return await page.screenshot({ type: 'png' }) as Buffer;
    }

    return await element.screenshot({ type: 'png' }) as Buffer;
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
