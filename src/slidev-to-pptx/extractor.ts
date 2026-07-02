import { chromium, Browser, BrowserContext, Page } from 'playwright';

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
