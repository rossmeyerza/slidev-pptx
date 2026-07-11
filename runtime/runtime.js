/* Runtime shell script. Do not edit: deck content lives in deck.json, slides/, and theme.css.
   UI/UX ported from Slidev's client (nav bar, overview, goto, clicks, presenter,
   drawing) reimplemented in dependency-free vanilla JS. */
(async () => {
  'use strict';

  const STAGE_WIDTH = 1280;
  const STAGE_HEIGHT = 720;
  const CLICKS_MAX = 999999;

  // ---------------------------------------------------------------- icons
  // Carbon icons (Apache-2.0, IBM), path data via @iconify-json/carbon.
  const ICON_VIEWBOX = { line: '0 0 24 24' };
  const ICONS = {
    'arrow-left': '<path fill="currentColor" d="m14 26l1.41-1.41L7.83 17H28v-2H7.83l7.58-7.59L14 6L4 16z"/>',
    'arrow-right': '<path fill="currentColor" d="m18 6l-1.43 1.393L24.15 15H4v2h20.15l-7.58 7.573L18 26l10-10z"/>',
    'apps': '<path fill="currentColor" d="M8 4v4H4V4Zm2-2H2v8h8Zm8 2v4h-4V4Zm2-2h-8v8h8Zm8 2v4h-4V4Zm2-2h-8v8h8ZM8 14v4H4v-4Zm2-2H2v8h8Zm8 2v4h-4v-4Zm2-2h-8v8h8Zm8 2v4h-4v-4Zm2-2h-8v8h8ZM8 24v4H4v-4Zm2-2H2v8h8Zm8 2v4h-4v-4Zm2-2h-8v8h8Zm8 2v4h-4v-4Zm2-2h-8v8h8Z"/>',
    'maximize': '<path fill="currentColor" d="M20 2v2h6.586L18 12.582L19.414 14L28 5.414V12h2V2zm-6 17.416L12.592 18L4 26.586V20H2v10h10v-2H5.414z"/>',
    'minimize': '<path fill="currentColor" d="M4 18v2h6.586L2 28.582L3.414 30L12 21.414V28h2V18zM30 3.416L28.592 2L20 10.586V4h-2v10h10v-2h-6.586z"/>',
    'user-speaker': '<path fill="currentColor" d="M29.415 19L27.7 17.285A3 3 0 0 0 28 16a3 3 0 1 0-3 3a3 3 0 0 0 1.286-.3L28 20.414V28h-6v-3a7.01 7.01 0 0 0-7-7H9a7.01 7.01 0 0 0-7 7v5h28v-9.586A2 2 0 0 0 29.415 19M4 25a5.006 5.006 0 0 1 5-5h6a5.006 5.006 0 0 1 5 5v3H4Z"/><path fill="currentColor" d="M12 4a5 5 0 1 1-5 5a5 5 0 0 1 5-5m0-2a7 7 0 1 0 7 7a7 7 0 0 0-7-7"/>',
    'presentation-file': '<path fill="currentColor" d="M15 10h2v8h-2zm5 4h2v4h-2zm-10-2h2v6h-2z"/><path fill="currentColor" d="M25 4h-8V2h-2v2H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v6h-4v2h10v-2h-4v-6h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 16H7V6h18Z"/>',
    'pen': '<path fill="currentColor" d="M27.307 6.107L30 3.414L28.586 2l-2.693 2.693L24.8 3.6a1.933 1.933 0 0 0-2.8 0l-18 18V28h6.4l18-18a1.933 1.933 0 0 0 0-2.8ZM9.6 26H6v-3.6L23.4 5L27 8.6ZM9 11.586L16.586 4L18 5.414L10.414 13z"/>',
    'close': '<path fill="currentColor" d="M17.414 16L24 9.414L22.586 8L16 14.586L9.414 8L8 9.414L14.586 16L8 22.586L9.414 24L16 17.414L22.586 24L24 22.586z"/>',
    'magic-wand': '<path fill="currentColor" d="M29.414 24L12 6.586a2.05 2.05 0 0 0-2.828 0L6.586 9.172a2 2 0 0 0 0 2.828l17.413 17.414a2 2 0 0 0 2.828 0l2.587-2.586a2 2 0 0 0 0-2.828M8 10.586L10.586 8l5 5l-2.587 2.587zM25.413 28l-11-10.999L17 14.414l11 11ZM2 16l2-2l2 2l-2 2zM14 4l2-2l2 2l-2 2zM2 4l2-2l2 2l-2 2z"/>',
    'magic-wand-filled': '<path fill="currentColor" d="M29.414 24L12 6.586a2.05 2.05 0 0 0-2.828 0L6.586 9.172a2 2 0 0 0 0 2.828l17.413 17.414a2 2 0 0 0 2.828 0l2.587-2.586a2 2 0 0 0 0-2.828M8 10.586L10.586 8l5 5l-2.587 2.587zM2 16l2-2l2 2l-2 2zM14 4l2-2l2 2l-2 2zM2 4l2-2l2 2l-2 2z"/>',
    'line': '<path fill="currentColor" d="M21.71 3.29a1 1 0 0 0-1.42 0l-18 18a1 1 0 0 0 0 1.42a1 1 0 0 0 1.42 0l18-18a1 1 0 0 0 0-1.42z"/>',
    'arrow-up-right': '<path fill="currentColor" d="M10 6v2h12.59L6 24.59L7.41 26L24 9.41V22h2V6z"/>',
    'radio-button': '<path fill="currentColor" d="M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m0 26a12 12 0 1 1 12-12a12 12 0 0 1-12 12"/>',
    'checkbox': '<path fill="currentColor" d="M26 4H6a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2M6 26V6h20v20Z"/>',
    'erase': '<path fill="currentColor" d="M7 27h23v2H7zm20.38-16.49l-7.93-7.92a2 2 0 0 0-2.83 0l-14 14a2 2 0 0 0 0 2.83L7.13 24h9.59l10.66-10.66a2 2 0 0 0 0-2.83M15.89 22H8l-4-4l6.31-6.31l7.93 7.92Zm3.76-3.76l-7.92-7.93L18 4l8 7.93Z"/>',
    'undo': '<path fill="currentColor" d="M20 10H7.815l3.587-3.586L10 5l-6 6l6 6l1.402-1.415L7.818 12H20a6 6 0 0 1 0 12h-8v2h8a8 8 0 0 0 0-16"/>',
    'redo': '<path fill="currentColor" d="M12 10h12.185l-3.587-3.586L22 5l6 6l-6 6l-1.402-1.415L24.182 12H12a6 6 0 0 0 0 12h8v2h-8a8 8 0 0 1 0-16"/>',
    'trash-can': '<path fill="currentColor" d="M12 12h2v12h-2zm6 0h2v12h-2z"/><path fill="currentColor" d="M4 6v2h2v20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8h2V6Zm4 22V8h16v20Zm4-26h8v2h-8z"/>',
    'close-outline': '<path fill="currentColor" d="M16 2C8.2 2 2 8.2 2 16s6.2 14 14 14s14-6.2 14-14S23.8 2 16 2m0 26C9.4 28 4 22.6 4 16S9.4 4 16 4s12 5.4 12 12s-5.4 12-12 12"/><path fill="currentColor" d="M21.4 23L16 17.6L10.6 23L9 21.4l5.4-5.4L9 10.6L10.6 9l5.4 5.4L21.4 9l1.6 1.6l-5.4 5.4l5.4 5.4z"/>',
    'zoom-in': '<path fill="currentColor" d="M18 12h-4V8h-2v4H8v2h4v4h2v-4h4z"/><path fill="currentColor" d="M21.448 20A10.86 10.86 0 0 0 24 13a11 11 0 1 0-11 11a10.86 10.86 0 0 0 7-2.552L27.586 29L29 27.586ZM13 22a9 9 0 1 1 9-9a9.01 9.01 0 0 1-9 9"/>',
    'zoom-out': '<path fill="currentColor" d="M8 12h10v2H8z"/><path fill="currentColor" d="M21.448 20A10.86 10.86 0 0 0 24 13a11 11 0 1 0-11 11a10.86 10.86 0 0 0 7-2.552L27.586 29L29 27.586ZM13 22a9 9 0 1 1 9-9a9.01 9.01 0 0 1-9 9"/>',
    'time': '<path fill="currentColor" d="M16 30a14 14 0 1 1 14-14a14 14 0 0 1-14 14m0-26a12 12 0 1 0 12 12A12 12 0 0 0 16 4"/><path fill="currentColor" d="M20.59 22L15 16.41V7h2v8.58l5 5.01z"/>',
    'pause': '<path fill="currentColor" d="M12 8v16H8V8zm0-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m12 2v16h-4V8zm0-2h-4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2"/>',
    'play': '<path fill="currentColor" d="M7 28a1 1 0 0 1-1-1V5a1 1 0 0 1 1.482-.876l20 11a1 1 0 0 1 0 1.752l-20 11A1 1 0 0 1 7 28M8 6.69v18.62L24.925 16Z"/>',
    'renew': '<path fill="currentColor" d="M12 10H6.78A11 11 0 0 1 27 16h2A13 13 0 0 0 6 7.68V4H4v8h8Zm8 12h5.22A11 11 0 0 1 5 16H3a13 13 0 0 0 23 8.32V28h2v-8h-8Z"/>',
    'stroke-width': '<g stroke="currentColor" stroke-linecap="round" fill="none"><line x1="2" y1="15" x2="22" y2="4" stroke-width="1"/><line x1="2" y1="24" x2="28" y2="10" stroke-width="2"/><line x1="7" y1="31" x2="29" y2="19" stroke-width="3"/></g>',
  };

  function icon(name) {
    const viewBox = ICON_VIEWBOX[name] || '0 0 32 32';
    return `<svg viewBox="${viewBox}" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  // ---------------------------------------------------------------- helpers
  const isPresenter = new URLSearchParams(location.search).has('presenter');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function iconButton(name, title, onClick) {
    const button = el('button', 'deck-icon-btn', `${icon(name)}<span class="sr-only">${title}</span>`);
    button.type = 'button';
    button.title = title;
    if (onClick) button.addEventListener('click', onClick);
    return button;
  }

  function setIcon(button, name) {
    const svg = button.querySelector('svg');
    if (svg) svg.outerHTML = icon(name).trim();
  }

  function divider() {
    return el('div', 'deck-divider');
  }

  // ---------------------------------------------------------------- deck loading
  const stage = document.querySelector('[data-stage]');
  const viewport = document.querySelector('[data-viewport]');

  let manifest = { title: 'Deck', slides: [] };
  let transitionMode = 'slide';
  let slides = [];
  let total = 0;
  let clickMeta = [];
  const parser = new DOMParser();

  function createClickMeta(slideNodes) {
    return slideNodes.map((slide) => {
      let auto = 0;
      let max = 0;
      const steps = new Map();
      slide.querySelectorAll('[data-click]').forEach((target) => {
        const raw = target.getAttribute('data-click');
        const explicit = Number(raw);
        const step = raw !== '' && Number.isInteger(explicit) && explicit > 0 ? explicit : ++auto;
        auto = Math.max(auto, step);
        max = Math.max(max, step);
        steps.set(target, step);
      });
      return { steps, total: max };
    });
  }

  async function loadDeck({ tolerateErrors = false } = {}) {
    let nextManifest;
    try {
      const response = await fetch('deck.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`deck.json: ${response.status}`);
      nextManifest = await response.json();
    } catch (error) {
      if (!tolerateErrors) throw error;
      nextManifest = { title: 'Deck', slides: [] };
    }

    const slidePaths = Array.isArray(nextManifest.slides) ? nextManifest.slides : [];
    const fragments = await Promise.all(slidePaths.map(async (slidePath) => {
      try {
        const response = await fetch(slidePath, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${slidePath}: ${response.status}`);
        return await response.text();
      } catch (error) {
        if (!tolerateErrors) throw error;
        return `<section class="slide slide-error"><h2>Missing slide</h2><p>${slidePath}</p></section>`;
      }
    }));

    const nextSlides = fragments.map((fragment, slideIndex) => {
      const doc = parser.parseFromString(fragment, 'text/html');
      let section = doc.body.querySelector('section.slide');
      if (!section) {
        section = doc.createElement('section');
        section.className = 'slide';
        while (doc.body.firstChild) section.appendChild(doc.body.firstChild);
      }
      section.dataset.slideIndex = String(slideIndex);
      return document.importNode(section, true);
    });

    slides.forEach((slide) => slide.remove());
    const deckNodes = document.createDocumentFragment();
    nextSlides.forEach((slide) => deckNodes.appendChild(slide));
    stage.insertBefore(deckNodes, stage.querySelector('.deck-drawing-svg, .deck-laser'));
    manifest = nextManifest;
    transitionMode = ['slide', 'fade', 'none'].includes(manifest.transition) ? manifest.transition : 'slide';
    slides = nextSlides;
    total = slides.length;
    clickMeta = createClickMeta(slides);
    if (manifest.title) document.title = manifest.title;
  }

  await loadDeck({ tolerateErrors: true });

  function slideTitle(slideIndex) {
    const slide = slides[slideIndex];
    return slide.dataset.title
      || slide.querySelector('h1, h2, h3')?.textContent?.trim()
      || `Slide ${slideIndex + 1}`;
  }

  // ---------------------------------------------------------------- clicks engine
  // Elements marked data-click reveal progressively (Slidev v-click semantics).
  // data-click="3" pins an explicit step; bare data-click auto-increments in
  // DOM order. clicksTotal(slide) = highest step on the slide.
  const clicksTotal = (index) => (clickMeta[index] ? clickMeta[index].total : 0);

  function applyClicks(slideIndex, click, root) {
    const meta = clickMeta[slideIndex];
    if (!meta || !meta.steps.size) return;
    if (root && root !== slides[slideIndex]) {
      // Clone: re-query by attribute in document order (matches build order).
      let auto = 0;
      root.querySelectorAll('[data-click]').forEach((target) => {
        const raw = target.getAttribute('data-click');
        const explicit = Number(raw);
        const step = raw !== '' && Number.isInteger(explicit) && explicit > 0 ? explicit : ++auto;
        auto = Math.max(auto, step);
        target.classList.toggle('click-hidden', step > click);
      });
      return;
    }
    meta.steps.forEach((step, target) => {
      target.classList.toggle('click-hidden', step > click);
    });
  }

  // ---------------------------------------------------------------- nav state
  const nav = { no: 1, click: 0 };

  function clampClick(no, click) {
    return Math.min(Math.max(click, 0), clicksTotal(no - 1));
  }

  function parseHash() {
    const match = String(location.hash).match(/^#\/(\d+)(?:\/(\d+))?/);
    if (!match) return { no: 1, click: 0 };
    const no = Math.min(Math.max(Number(match[1]) || 1, 1), Math.max(total, 1));
    return { no, click: clampClick(no, Number(match[2]) || 0) };
  }

  function writeHash() {
    const hash = nav.click > 0 ? `#/${nav.no}/${nav.click}` : `#/${nav.no}`;
    history.replaceState(null, '', hash);
  }

  const hasNext = () => nav.no < total || nav.click < clicksTotal(nav.no - 1);
  const hasPrev = () => nav.no > 1 || nav.click > 0;

  // slide transition bookkeeping
  let transitionCleanup = null;

  function finishTransition() {
    if (transitionCleanup) {
      const cleanup = transitionCleanup;
      transitionCleanup = null;
      cleanup();
    }
  }

  function animateSlideChange(fromIndex, toIndex, direction) {
    const fromSlide = slides[fromIndex];
    const toSlide = slides[toIndex];
    const mode = transitionMode;
    const classes = {
      slide: {
        enter: direction >= 0 ? 'slide-enter-right' : 'slide-enter-left',
        leave: direction >= 0 ? 'slide-leave-left' : 'slide-leave-right',
      },
      fade: { enter: 'fade-out', leave: 'fade-out' },
    }[mode];
    if (!classes) return false;

    toSlide.classList.add(classes.enter);
    // force reflow so the enter position applies before transitioning
    void toSlide.offsetWidth;
    fromSlide.classList.add('transitioning');
    toSlide.classList.add('transitioning');
    fromSlide.classList.add(classes.leave);
    toSlide.classList.remove(classes.enter);

    const timer = setTimeout(finishTransition, 600);
    transitionCleanup = () => {
      clearTimeout(timer);
      fromSlide.style.display = 'none';
      fromSlide.setAttribute('aria-hidden', 'true');
      fromSlide.classList.remove('transitioning', classes.leave, classes.enter, 'fade-out');
      toSlide.classList.remove('transitioning', classes.leave, classes.enter, 'fade-out');
    };
    return true;
  }

  const navListeners = [];
  const onNavChange = (fn) => navListeners.push(fn);

  function render(previous, options = {}) {
    if (!total) return;
    const slideChanged = !previous || previous.no !== nav.no;
    const animate = slideChanged && previous && !options.instant && !prefersReducedMotion && transitionMode !== 'none';

    finishTransition();
    slides.forEach((slide, index) => {
      const isActive = index === nav.no - 1;
      const keepVisible = animate && index === previous.no - 1;
      slide.classList.toggle('is-active', isActive);
      if (!keepVisible) {
        slide.style.display = isActive ? '' : 'none';
        slide.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      }
    });
    applyClicks(nav.no - 1, nav.click);
    if (animate) {
      const direction = options.direction ?? (nav.no >= previous.no ? 1 : -1);
      animateSlideChange(previous.no - 1, nav.no - 1, direction);
    }
    writeHash();
    navListeners.forEach((fn) => fn(slideChanged));
  }

  function go(no, click = 0, options = {}) {
    if (!total) return;
    const previous = { ...nav };
    nav.no = Math.min(Math.max(no, 1), total);
    nav.click = click === CLICKS_MAX ? clicksTotal(nav.no - 1) : clampClick(nav.no, click);
    if (previous.no === nav.no && previous.click === nav.click && !options.force) return;
    render(previous, options);
    if (!options.remote) broadcastNav();
  }

  function next() {
    if (nav.click < clicksTotal(nav.no - 1)) go(nav.no, nav.click + 1);
    else if (nav.no < total) go(nav.no + 1, 0, { direction: 1 });
  }

  function prev() {
    if (nav.click > 0) go(nav.no, nav.click - 1);
    else if (nav.no > 1) go(nav.no - 1, CLICKS_MAX, { direction: -1 });
  }

  const nextSlide = () => go(nav.no + 1, 0, { direction: 1 });
  const prevSlide = () => go(nav.no - 1, 0, { direction: -1 });

  // ---------------------------------------------------------------- stage scaling
  function fitStage() {
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(rect.width / STAGE_WIDTH, rect.height / STAGE_HEIGHT);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  new ResizeObserver(fitStage).observe(viewport);
  window.addEventListener('resize', fitStage);

  // ---------------------------------------------------------------- thumbnails
  function buildThumb(slideIndex, width, { revealAll = true, click = 0 } = {}) {
    const thumb = el('div', `deck-thumb${revealAll ? ' reveal-all' : ''}`);
    const scale = width / STAGE_WIDTH;
    thumb.style.width = `${width}px`;
    thumb.style.height = `${Math.round(width * STAGE_HEIGHT / STAGE_WIDTH)}px`;
    const thumbStage = el('div', 'deck-thumb-stage');
    thumbStage.style.transform = `scale(${scale})`;
    const clone = slides[slideIndex].cloneNode(true);
    clone.style.display = '';
    clone.removeAttribute('aria-hidden');
    clone.classList.remove('is-active', 'transitioning', 'slide-enter-right', 'slide-enter-left', 'slide-leave-right', 'slide-leave-left', 'fade-out');
    clone.querySelectorAll('.deck-drawing-svg, .deck-laser').forEach((extra) => extra.remove());
    if (!revealAll) applyClicks(slideIndex, click, clone);
    thumbStage.appendChild(clone);
    thumb.appendChild(thumbStage);
    return thumb;
  }

  // ---------------------------------------------------------------- overview ('o')
  const overview = el('div', 'deck-overview');
  overview.hidden = true;
  document.body.appendChild(overview);
  let overviewFocus = 0;
  let overviewBuffer = '';

  function overviewColumns() {
    const grid = overview.querySelector('.deck-overview-grid');
    if (!grid) return 1;
    return Math.max(1, Math.floor((grid.clientWidth + 32) / (300 + 32)));
  }

  function buildOverview() {
    overview.innerHTML = '';
    const close = iconButton('close', 'Close overview', () => toggleOverview(false));
    close.classList.add('deck-overview-close');
    const grid = el('div', 'deck-overview-grid');
    slides.forEach((_, index) => {
      const item = el('div', 'deck-overview-item');
      const card = el('div', 'deck-overview-card');
      card.appendChild(buildThumb(index, 300));
      card.addEventListener('click', (event) => {
        event.stopPropagation();
        go(index + 1);
        toggleOverview(false);
      });
      const no = el('div', 'deck-overview-no', String(index + 1));
      no.style.left = '307px';
      item.appendChild(card);
      item.appendChild(no);
      grid.appendChild(item);
    });
    overview.appendChild(grid);
    overview.appendChild(close);
  }

  function highlightOverview() {
    overview.querySelectorAll('.deck-overview-item').forEach((item, index) => {
      item.classList.toggle('is-current', index === overviewFocus);
      item.classList.toggle('is-typed', overviewBuffer !== '' && String(index + 1).startsWith(overviewBuffer));
    });
    overview.querySelectorAll('.deck-overview-item')[overviewFocus]
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function toggleOverview(force) {
    const show = force ?? overview.hidden;
    if (show === !overview.hidden) return;
    if (show) {
      buildOverview();
      overviewFocus = nav.no - 1;
      overviewBuffer = '';
      overview.hidden = false;
      overview.classList.add('opening');
      requestAnimationFrame(() => requestAnimationFrame(() => overview.classList.remove('opening')));
      highlightOverview();
    } else {
      overview.classList.add('closing');
      setTimeout(() => {
        overview.hidden = true;
        overview.classList.remove('closing');
      }, 200);
    }
  }

  overview.addEventListener('click', (event) => {
    if (event.target === overview || event.target.classList.contains('deck-overview-grid')) toggleOverview(false);
  });

  function overviewKeydown(event) {
    const columns = overviewColumns();
    if (/^[0-9]$/.test(event.key)) {
      const buffer = overviewBuffer + event.key;
      const value = Number(buffer);
      if (value > total || (overviewBuffer === '' && event.key === '0')) overviewBuffer = '';
      else {
        overviewBuffer = buffer;
        overviewFocus = value - 1;
        if (value * 10 > total) {
          go(value);
          toggleOverview(false);
          return;
        }
      }
      highlightOverview();
      return;
    }
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (event.key in moves) {
      event.preventDefault();
      overviewFocus = Math.min(Math.max(overviewFocus + moves[event.key], 0), total - 1);
      overviewBuffer = '';
      highlightOverview();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      go(overviewBuffer ? Number(overviewBuffer) : overviewFocus + 1);
      toggleOverview(false);
      return;
    }
    if (event.key === 'Escape' || event.key.toLowerCase() === 'o' || event.key === '`') {
      event.preventDefault();
      toggleOverview(false);
    }
  }

  // ---------------------------------------------------------------- goto ('g')
  const gotoDialog = el('div', 'deck-goto');
  gotoDialog.innerHTML = '<div class="deck-goto-box"><input type="text" placeholder="Goto..." aria-label="Go to slide"></div><div class="deck-goto-list" role="listbox"></div>';
  document.body.appendChild(gotoDialog);
  const gotoInput = gotoDialog.querySelector('input');
  const gotoList = gotoDialog.querySelector('.deck-goto-list');
  let gotoSelected = -1;
  let gotoMatches = [];

  function gotoOpen() {
    gotoDialog.classList.add('open');
    gotoInput.value = '';
    gotoRefresh();
    setTimeout(() => gotoInput.focus(), 0);
  }

  function gotoClose() {
    gotoDialog.classList.remove('open');
    gotoInput.value = '';
    gotoInput.classList.remove('invalid');
    gotoList.innerHTML = '';
    gotoInput.blur();
  }

  function gotoRefresh() {
    const query = gotoInput.value.trim().replace(/^\//, '').toLowerCase();
    gotoSelected = -1;
    gotoMatches = [];
    if (query) {
      slides.forEach((_, index) => {
        const no = String(index + 1);
        const title = slideTitle(index).toLowerCase();
        if (no.startsWith(query) || title.includes(query)) gotoMatches.push(index);
      });
    }
    const valid = gotoMatches.length > 0 || (Number(query) >= 1 && Number(query) <= total);
    gotoInput.classList.toggle('invalid', query !== '' && !valid);
    gotoList.innerHTML = '';
    gotoMatches.slice(0, 12).forEach((index, position) => {
      const item = el('div', 'deck-goto-item', `<span class="no">${index + 1}</span><span>${slideTitle(index)}</span>`);
      item.setAttribute('role', 'option');
      item.addEventListener('click', () => {
        go(index + 1);
        gotoClose();
      });
      item.classList.toggle('is-selected', position === gotoSelected);
      gotoList.appendChild(item);
    });
  }

  gotoInput.addEventListener('input', gotoRefresh);
  gotoInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const query = gotoInput.value.trim().replace(/^\//, '');
      const target = gotoSelected >= 0 ? gotoMatches[gotoSelected] + 1 : Number(query);
      if (Number.isInteger(target) && target >= 1 && target <= total) {
        go(target);
        gotoClose();
      } else if (gotoMatches.length) {
        go(gotoMatches[0] + 1);
        gotoClose();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      gotoClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const count = Math.min(gotoMatches.length, 12);
      if (!count) return;
      gotoSelected = (gotoSelected + delta + count) % count;
      gotoList.querySelectorAll('.deck-goto-item').forEach((item, index) => {
        item.classList.toggle('is-selected', index === gotoSelected);
      });
    }
    event.stopPropagation();
  });
  gotoDialog.addEventListener('focusout', (event) => {
    if (!gotoDialog.contains(event.relatedTarget)) gotoClose();
  });

  // ---------------------------------------------------------------- drawing
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BRUSH_COLORS = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ffffff', '#000000'];
  const drawing = {
    enabled: false,
    brush: { color: '#ff595e', size: 4, mode: 'stylus' },
    groups: new Map(),
    undoStacks: new Map(),
    redoStacks: new Map(),
  };
  try {
    Object.assign(drawing.brush, JSON.parse(localStorage.getItem('deck-drawing-brush') || '{}'));
  } catch { /* keep defaults */ }
  if (!BRUSH_COLORS.includes(drawing.brush.color)) drawing.brush.color = '#ff595e';

  const drawingSvg = document.createElementNS(SVG_NS, 'svg');
  drawingSvg.setAttribute('class', 'deck-drawing-svg');
  drawingSvg.setAttribute('viewBox', `0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`);
  stage.appendChild(drawingSvg);

  function drawingGroup(no) {
    if (!drawing.groups.has(no)) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.dataset.drawingSlide = String(no);
      group.style.display = 'none';
      drawingSvg.appendChild(group);
      drawing.groups.set(no, group);
      drawing.undoStacks.set(no, []);
      drawing.redoStacks.set(no, []);
    }
    return drawing.groups.get(no);
  }

  function showDrawingsFor(no) {
    drawing.groups.forEach((group, groupNo) => {
      group.style.display = groupNo === no ? '' : 'none';
    });
    drawingGroup(no).style.display = '';
  }

  function stagePoint(event) {
    const rect = stage.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (STAGE_WIDTH / rect.width),
      y: (event.clientY - rect.top) * (STAGE_HEIGHT / rect.height),
    };
  }

  function strokeAttrs(shape) {
    shape.setAttribute('fill', 'none');
    shape.setAttribute('stroke', drawing.brush.color);
    shape.setAttribute('stroke-width', String(drawing.brush.size));
    shape.setAttribute('stroke-linecap', 'round');
    shape.setAttribute('stroke-linejoin', 'round');
  }

  function smoothPath(points) {
    if (points.length < 3) {
      return points.length
        ? `M ${points[0].x} ${points[0].y}` + points.slice(1).map((p) => ` L ${p.x} ${p.y}`).join('')
        : '';
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  }

  function arrowPath(from, to) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head = Math.max(10, drawing.brush.size * 3);
    const spread = Math.PI / 7;
    const wing = (offset) => `M ${to.x} ${to.y} L ${to.x - head * Math.cos(angle + offset)} ${to.y - head * Math.sin(angle + offset)}`;
    return `M ${from.x} ${from.y} L ${to.x} ${to.y} ${wing(spread)} ${wing(-spread)}`;
  }

  let activeStroke = null;

  function drawingChanged() {
    updateDrawingUi();
    broadcastDrawings(nav.no);
  }

  drawingSvg.addEventListener('pointerdown', (event) => {
    if (!drawing.enabled || event.button !== 0) return;
    event.preventDefault();
    drawingSvg.setPointerCapture(event.pointerId);
    const start = stagePoint(event);
    const group = drawingGroup(nav.no);

    if (drawing.brush.mode === 'eraseLine') {
      const target = event.target.closest('[data-stroke]');
      if (target && group.contains(target)) {
        target.remove();
        drawing.undoStacks.get(nav.no).push({ op: 'remove', node: target });
        drawing.redoStacks.set(nav.no, []);
        drawingChanged();
      }
      return;
    }

    const shape = document.createElementNS(SVG_NS, drawing.brush.mode === 'rectangle' ? 'rect' : drawing.brush.mode === 'ellipse' ? 'ellipse' : 'path');
    shape.dataset.stroke = drawing.brush.mode;
    strokeAttrs(shape);
    group.appendChild(shape);
    activeStroke = { shape, start, points: [start], moved: false };
    updateStroke(start);
  });

  function updateStroke(point) {
    if (!activeStroke) return;
    const { shape, start } = activeStroke;
    const mode = drawing.brush.mode;
    if (mode === 'stylus') {
      activeStroke.points.push(point);
      shape.setAttribute('d', smoothPath(activeStroke.points));
    } else if (mode === 'line') {
      shape.setAttribute('d', `M ${start.x} ${start.y} L ${point.x} ${point.y}`);
    } else if (mode === 'arrow') {
      shape.setAttribute('d', arrowPath(start, point));
    } else if (mode === 'rectangle') {
      shape.setAttribute('x', String(Math.min(start.x, point.x)));
      shape.setAttribute('y', String(Math.min(start.y, point.y)));
      shape.setAttribute('width', String(Math.abs(point.x - start.x)));
      shape.setAttribute('height', String(Math.abs(point.y - start.y)));
    } else if (mode === 'ellipse') {
      shape.setAttribute('cx', String((start.x + point.x) / 2));
      shape.setAttribute('cy', String((start.y + point.y) / 2));
      shape.setAttribute('rx', String(Math.abs(point.x - start.x) / 2));
      shape.setAttribute('ry', String(Math.abs(point.y - start.y) / 2));
    }
  }

  drawingSvg.addEventListener('pointermove', (event) => {
    if (!activeStroke) return;
    const point = stagePoint(event);
    const dx = point.x - activeStroke.start.x;
    const dy = point.y - activeStroke.start.y;
    if (Math.hypot(dx, dy) > 1) activeStroke.moved = true;
    updateStroke(point);
  });

  function endStroke() {
    if (!activeStroke) return;
    const { shape, moved } = activeStroke;
    activeStroke = null;
    if (!moved && drawing.brush.mode !== 'stylus') {
      shape.remove();
      return;
    }
    drawing.undoStacks.get(nav.no).push({ op: 'add', node: shape });
    drawing.redoStacks.set(nav.no, []);
    drawingChanged();
  }

  drawingSvg.addEventListener('pointerup', endStroke);
  drawingSvg.addEventListener('pointercancel', endStroke);

  function undoDrawing() {
    const undoStack = drawing.undoStacks.get(nav.no) || [];
    const action = undoStack.pop();
    if (!action) return;
    if (action.op === 'add') action.node.remove();
    else drawingGroup(nav.no).appendChild(action.node);
    (drawing.redoStacks.get(nav.no) || []).push(action);
    drawingChanged();
  }

  function redoDrawing() {
    const redoStack = drawing.redoStacks.get(nav.no) || [];
    const action = redoStack.pop();
    if (!action) return;
    if (action.op === 'add') drawingGroup(nav.no).appendChild(action.node);
    else action.node.remove();
    (drawing.undoStacks.get(nav.no) || []).push(action);
    drawingChanged();
  }

  function clearDrawing() {
    const group = drawingGroup(nav.no);
    if (!group.childNodes.length) return;
    group.innerHTML = '';
    drawing.undoStacks.set(nav.no, []);
    drawing.redoStacks.set(nav.no, []);
    drawingChanged();
  }

  function setDrawingEnabled(enabled) {
    drawing.enabled = enabled;
    stage.classList.toggle('drawing-enabled', enabled);
    drawingControls.hidden = !enabled;
    drawingGroup(nav.no).style.pointerEvents = drawing.brush.mode === 'eraseLine' && enabled ? 'visiblePainted' : 'none';
    updateDrawingUi();
    updateNavBar();
  }

  function setBrush(patch) {
    Object.assign(drawing.brush, patch);
    localStorage.setItem('deck-drawing-brush', JSON.stringify(drawing.brush));
    drawing.groups.forEach((group) => {
      group.style.pointerEvents = drawing.brush.mode === 'eraseLine' && drawing.enabled ? 'visiblePainted' : 'none';
    });
    updateDrawingUi();
  }

  // drawing toolbar
  const drawingControls = el('div', 'deck-drawing-controls');
  drawingControls.hidden = true;
  document.body.appendChild(drawingControls);

  const toolButtons = new Map();
  [['stylus', 'pen', 'Draw with stylus'], ['line', 'line', 'Draw a line'], ['arrow', 'arrow-up-right', 'Draw an arrow'], ['ellipse', 'radio-button', 'Draw an ellipse'], ['rectangle', 'checkbox', 'Draw a rectangle'], ['eraseLine', 'erase', 'Erase strokes']]
    .forEach(([mode, iconName, title]) => {
      const button = iconButton(iconName, title, () => setBrush({ mode }));
      toolButtons.set(mode, button);
      drawingControls.appendChild(button);
    });
  drawingControls.appendChild(divider());

  const sizeWrap = el('div');
  sizeWrap.style.position = 'relative';
  const sizeButton = iconButton('stroke-width', 'Stroke width', () => {
    sizePop.hidden = !sizePop.hidden;
  });
  const sizePop = el('div', 'deck-size-pop', `<span class="value">${drawing.brush.size}</span><input type="range" min="1" max="15" step="1" value="${drawing.brush.size}" aria-label="Stroke width">`);
  sizePop.hidden = true;
  sizePop.querySelector('input').addEventListener('input', (event) => {
    setBrush({ size: Number(event.target.value) });
    sizePop.querySelector('.value').textContent = event.target.value;
  });
  sizeWrap.appendChild(sizeButton);
  sizeWrap.appendChild(sizePop);
  drawingControls.appendChild(sizeWrap);

  const colorButtons = new Map();
  BRUSH_COLORS.forEach((color) => {
    const button = el('button', 'deck-icon-btn', `<span class="sr-only">Brush color ${color}</span>`);
    button.type = 'button';
    button.title = `Brush color ${color}`;
    const swatch = el('div', 'swatch');
    button.prepend(swatch);
    button.addEventListener('click', () => setBrush({ color, mode: drawing.brush.mode === 'eraseLine' ? 'stylus' : drawing.brush.mode }));
    colorButtons.set(color, button);
    drawingControls.appendChild(button);
  });
  drawingControls.appendChild(divider());

  const undoButton = iconButton('undo', 'Undo', undoDrawing);
  const redoButton = iconButton('redo', 'Redo', redoDrawing);
  const clearButton = iconButton('trash-can', 'Clear slide drawings', clearDrawing);
  const closeDrawButton = iconButton('close-outline', 'Stop drawing', () => setDrawingEnabled(false));
  [undoButton, redoButton, clearButton, divider(), closeDrawButton].forEach((node) => drawingControls.appendChild(node));

  function updateDrawingUi() {
    toolButtons.forEach((button, mode) => {
      button.classList.toggle('shallow', drawing.brush.mode !== mode);
      button.classList.toggle('active', drawing.brush.mode === mode);
    });
    colorButtons.forEach((button, color) => {
      const selected = drawing.brush.color === color && drawing.brush.mode !== 'eraseLine';
      button.classList.toggle('active', selected);
      button.classList.toggle('shallow', !selected);
      const swatch = button.querySelector('.swatch');
      swatch.style.background = drawing.enabled ? color : 'transparent';
      swatch.style.borderColor = drawing.enabled ? (color === '#ffffff' ? 'rgba(209,213,219,.5)' : '#ffffff') : color;
    });
    undoButton.classList.toggle('disabled', !(drawing.undoStacks.get(nav.no) || []).length);
    redoButton.classList.toggle('disabled', !(drawing.redoStacks.get(nav.no) || []).length);
    clearButton.classList.toggle('disabled', !drawingGroup(nav.no).childNodes.length);
    const underline = penButton?.querySelector('.brush-underline');
    if (underline) underline.style.background = drawing.brush.color;
  }

  // ---------------------------------------------------------------- laser pointer
  let laserActive = false;
  const laserDot = el('div', 'deck-laser');
  laserDot.style.display = 'none';
  stage.appendChild(laserDot);

  function setLaser(active) {
    laserActive = active;
    stage.classList.toggle('laser-active', active);
    if (!active) {
      laserDot.style.display = 'none';
      broadcast({ type: 'cursor', active: false });
    }
    updateNavBar();
  }

  function moveLaser(x, y) {
    laserDot.style.display = '';
    laserDot.style.left = `${x}px`;
    laserDot.style.top = `${y}px`;
  }

  let laserRaf = 0;
  stage.addEventListener('pointermove', (event) => {
    if (!laserActive) return;
    const point = stagePoint(event);
    moveLaser(point.x, point.y);
    if (!laserRaf) {
      laserRaf = requestAnimationFrame(() => {
        laserRaf = 0;
        broadcast({ type: 'cursor', active: true, x: point.x, y: point.y });
      });
    }
  });
  stage.addEventListener('pointerleave', () => {
    if (laserActive) {
      laserDot.style.display = 'none';
      broadcast({ type: 'cursor', active: false });
    }
  });

  // ---------------------------------------------------------------- cross-window sync
  const deckId = location.pathname.match(/^\/runtime\/([^/]+)/)?.[1];
  const channelKey = `deck-sync:${deckId || location.pathname}`;
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(channelKey) : null;
  let applyingRemote = false;

  function broadcast(message) {
    channel?.postMessage(message);
  }

  function broadcastNav() {
    if (applyingRemote) return;
    broadcast({ type: 'nav', no: nav.no, click: nav.click });
  }

  function broadcastDrawings(no) {
    if (applyingRemote) return;
    broadcast({ type: 'drawings', no, svg: drawingGroup(no).innerHTML });
  }

  channel?.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    applyingRemote = true;
    try {
      if (message.type === 'nav') {
        go(message.no, message.click, { instant: true, remote: true });
      } else if (message.type === 'drawings') {
        drawingGroup(message.no).innerHTML = message.svg;
        drawing.undoStacks.set(message.no, []);
        drawing.redoStacks.set(message.no, []);
        if (message.no === nav.no) updateDrawingUi();
      } else if (message.type === 'cursor') {
        if (message.active) moveLaser(message.x, message.y);
        else laserDot.style.display = 'none';
      }
    } finally {
      applyingRemote = false;
    }
  });

  // ---------------------------------------------------------------- nav bar
  const navWrapper = document.querySelector('[data-nav-wrapper]');
  const controls = document.querySelector('[data-controls]');
  let penButton = null;
  let prevButton = null;
  let nextButton = null;
  let fullscreenButton = null;
  let laserButton = null;
  let counterEl = null;

  function buildNavBar() {
    controls.innerHTML = '';
    if (document.fullscreenEnabled) {
      fullscreenButton = iconButton('maximize', 'Enter fullscreen', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      });
      controls.appendChild(fullscreenButton);
    }
    prevButton = iconButton('arrow-left', 'Go to previous slide', prev);
    nextButton = iconButton('arrow-right', 'Go to next slide', next);
    controls.appendChild(prevButton);
    controls.appendChild(nextButton);
    controls.appendChild(iconButton('apps', 'Show slide overview', () => toggleOverview()));
    controls.appendChild(divider());

    laserButton = iconButton('magic-wand', 'Toggle laser pointer', () => setLaser(!laserActive));
    controls.appendChild(laserButton);
    penButton = iconButton('pen', 'Toggle drawing', () => setDrawingEnabled(!drawing.enabled));
    penButton.appendChild(el('span', 'brush-underline'));
    controls.appendChild(penButton);
    controls.appendChild(divider());

    if (isPresenter) {
      controls.appendChild(iconButton('presentation-file', 'Exit presenter mode', () => {
        const url = new URL(location.href);
        url.searchParams.delete('presenter');
        location.href = url.toString();
      }));
    } else {
      controls.appendChild(iconButton('user-speaker', 'Open presenter mode', () => {
        const url = new URL(location.href);
        url.searchParams.set('presenter', '');
        window.open(url.toString(), '_blank');
      }));
    }
    controls.appendChild(divider());

    counterEl = el('div', 'deck-counter', '<span class="current">–</span><span class="total"></span>');
    counterEl.title = 'Go to slide...';
    counterEl.addEventListener('click', gotoOpen);
    controls.appendChild(counterEl);
    updateNavBar();
  }

  function updateNavBar() {
    if (!counterEl) return;
    counterEl.querySelector('.current').textContent = String(nav.no);
    counterEl.querySelector('.total').textContent = ` / ${total}`;
    prevButton.classList.toggle('disabled', !hasPrev());
    nextButton.classList.toggle('disabled', !hasNext());
    penButton.classList.toggle('active', drawing.enabled);
    laserButton.classList.toggle('active', laserActive);
    setIcon(laserButton, laserActive ? 'magic-wand-filled' : 'magic-wand');
    if (fullscreenButton) {
      setIcon(fullscreenButton, document.fullscreenElement ? 'minimize' : 'maximize');
      fullscreenButton.title = document.fullscreenElement ? 'Close fullscreen' : 'Enter fullscreen';
    }
  }

  document.addEventListener('fullscreenchange', updateNavBar);
  navWrapper.addEventListener('mouseleave', () => {
    if (navWrapper.contains(document.activeElement)) document.activeElement.blur();
  });
  buildNavBar();

  // ---------------------------------------------------------------- progress bar
  const progressFill = document.querySelector('[data-progress-fill]');

  function updateProgress() {
    if (!progressFill) return;
    if (total < 2) {
      progressFill.style.width = '0%';
      return;
    }
    const clickShare = clicksTotal(nav.no - 1) ? nav.click / (clicksTotal(nav.no - 1) + 1) : 0;
    const ratio = (nav.no - 1 + clickShare) / (total - 1);
    progressFill.style.width = `${Math.min(ratio, 1) * 100}%`;
  }

  // ---------------------------------------------------------------- presenter mode
  const presenter = { notesBody: null, nextStage: null, progress: null, timerEl: null };

  function buildPresenter() {
    document.body.classList.add('presenter');
    navWrapper.classList.add('persist');

    const root = el('div', 'deck-presenter');
    const progress = el('header', 'deck-presenter-progress');
    const grid = el('div', 'deck-presenter-grid');

    const main = el('section', 'deck-presenter-main');
    main.appendChild(el('div', 'deck-panel-label', 'Current'));
    main.appendChild(viewport);

    const nextPanel = el('section', 'deck-presenter-next');
    nextPanel.appendChild(el('div', 'deck-panel-label', 'Next'));
    const nextStage = el('div', 'deck-panel-stage');
    nextPanel.appendChild(nextStage);

    const notePanel = el('section', 'deck-presenter-note');
    const noteBody = el('div', 'note-body');
    const noteFooter = el('div', 'note-footer');
    let noteScale = Number(localStorage.getItem('deck-presenter-font-size')) || 1.2;
    const applyNoteScale = () => {
      noteScale = Math.min(Math.max(noteScale, 0.5), 2);
      noteBody.style.fontSize = `${noteScale}em`;
      localStorage.setItem('deck-presenter-font-size', String(noteScale));
    };
    noteFooter.appendChild(iconButton('zoom-out', 'Decrease notes size', () => { noteScale -= 0.1; applyNoteScale(); }));
    noteFooter.appendChild(iconButton('zoom-in', 'Increase notes size', () => { noteScale += 0.1; applyNoteScale(); }));
    applyNoteScale();
    notePanel.appendChild(noteBody);
    notePanel.appendChild(noteFooter);

    const bottom = el('section', 'deck-presenter-bottom');
    bottom.appendChild(navWrapper);
    bottom.appendChild(buildTimer());

    grid.appendChild(main);
    grid.appendChild(nextPanel);
    grid.appendChild(notePanel);
    grid.appendChild(bottom);
    root.appendChild(progress);
    root.appendChild(grid);
    document.body.appendChild(root);

    presenter.notesBody = noteBody;
    presenter.nextStage = nextStage;
    presenter.progress = progress;
    new ResizeObserver(() => {
      fitStage();
      renderNextPreview();
    }).observe(nextStage);
  }

  function buildTimer() {
    const timer = el('div', 'deck-timer stopped');
    timer.innerHTML = `<div class="timer-buttons"></div><span class="timer-idle-icon deck-icon-btn">${icon('time')}</span><span class="time">00:00</span>`;
    const buttons = timer.querySelector('.timer-buttons');
    const playPause = iconButton('play', 'Start/pause timer', (event) => {
      event.stopPropagation();
      toggleTimer();
    });
    const reset = iconButton('renew', 'Reset timer', (event) => {
      event.stopPropagation();
      resetTimer();
    });
    buttons.appendChild(playPause);
    buttons.appendChild(reset);
    timer.addEventListener('click', toggleTimer);
    presenter.timerEl = timer;
    presenter.timerPlayPause = playPause;
    return timer;
  }

  const timerState = { status: 'stopped', startedAt: 0, elapsedBefore: 0 };

  function timerElapsed() {
    return timerState.elapsedBefore + (timerState.status === 'running' ? Date.now() - timerState.startedAt : 0);
  }

  function toggleTimer() {
    if (timerState.status === 'running') {
      timerState.elapsedBefore = timerElapsed();
      timerState.status = 'paused';
    } else {
      timerState.startedAt = Date.now();
      timerState.status = 'running';
    }
    renderTimer();
  }

  function resetTimer() {
    timerState.status = 'stopped';
    timerState.elapsedBefore = 0;
    renderTimer();
  }

  function renderTimer() {
    const timer = presenter.timerEl;
    if (!timer) return;
    const totalSeconds = Math.floor(timerElapsed() / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value) => String(value).padStart(2, '0');
    timer.querySelector('.time').textContent = hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
    timer.className = `deck-timer ${timerState.status}`;
    setIcon(presenter.timerPlayPause, timerState.status === 'running' ? 'pause' : 'play');
  }

  if (isPresenter) setInterval(renderTimer, 250);

  function nextFrame() {
    if (nav.click < clicksTotal(nav.no - 1)) return { no: nav.no, click: nav.click + 1 };
    if (nav.no < total) return { no: nav.no + 1, click: 0 };
    return null;
  }

  function renderNextPreview() {
    const container = presenter.nextStage;
    if (!container) return;
    container.innerHTML = '';
    const frame = nextFrame();
    if (!frame) {
      container.appendChild(el('div', 'deck-presenter-end', 'End of the presentation'));
      return;
    }
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const width = Math.min(rect.width, rect.height * STAGE_WIDTH / STAGE_HEIGHT);
    container.appendChild(buildThumb(frame.no - 1, Math.max(width, 40), { revealAll: false, click: frame.click }));
  }

  function renderPresenterExtras() {
    if (!isPresenter) return;
    // notes
    const notes = slides[nav.no - 1]?.querySelector('aside.notes');
    if (notes && notes.innerHTML.trim()) {
      presenter.notesBody.classList.remove('empty');
      presenter.notesBody.innerHTML = notes.innerHTML;
    } else {
      presenter.notesBody.classList.add('empty');
      presenter.notesBody.textContent = 'No notes.';
    }
    // segmented progress
    const progress = presenter.progress;
    if (progress.childElementCount !== Math.max(total - 1, 0)) {
      progress.innerHTML = '';
      for (let i = 0; i < total - 1; i += 1) {
        const seg = el('div', 'seg', '<span class="fill" style="width:0"></span>');
        seg.style.width = `${100 / (total - 1)}%`;
        progress.appendChild(seg);
      }
    }
    Array.from(progress.children).forEach((seg, index) => {
      seg.classList.toggle('past', index < nav.no - 1);
      const fill = seg.querySelector('.fill');
      const isCurrent = index === nav.no - 1;
      fill.style.width = isCurrent && clicksTotal(nav.no - 1)
        ? `${(nav.click / (clicksTotal(nav.no - 1) + 1)) * 100}%`
        : '0';
    });
    renderNextPreview();
  }

  // ---------------------------------------------------------------- click-to-advance on stage
  stage.addEventListener('click', (event) => {
    if (drawing.enabled || laserActive) return;
    if (event.target.closest('a, button, input, textarea, select, video, audio, [contenteditable]')) return;
    if (window.getSelection()?.toString()) return;
    const rect = stage.getBoundingClientRect();
    if ((event.clientX - rect.left) / rect.width > 0.5) next();
    else prev();
  });

  // ---------------------------------------------------------------- keyboard
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    if (!overview.hidden) {
      overviewKeydown(event);
      return;
    }

    if (drawing.enabled) {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoDrawing();
        else undoDrawing();
        return;
      }
      if (event.key === 'Escape') {
        setDrawingEnabled(false);
        return;
      }
      const tools = { s: 'stylus', l: 'line', a: 'arrow', r: 'rectangle', e: 'ellipse' };
      if (key in tools) {
        setBrush({ mode: tools[key] });
        return;
      }
      if (key === 'c') {
        clearDrawing();
        return;
      }
      if (/^[1-7]$/.test(event.key)) {
        setBrush({ color: BRUSH_COLORS[Number(event.key) - 1] });
        return;
      }
    }

    switch (event.key) {
      case ' ':
        event.preventDefault();
        if (event.shiftKey) prev();
        else next();
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (event.shiftKey) nextSlide();
        else next();
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (event.shiftKey) prevSlide();
        else prev();
        return;
      case 'PageDown':
        event.preventDefault();
        next();
        return;
      case 'PageUp':
        event.preventDefault();
        prev();
        return;
      case 'ArrowDown':
        event.preventDefault();
        nextSlide();
        return;
      case 'ArrowUp':
        event.preventDefault();
        prevSlide();
        return;
      case 'Home':
        event.preventDefault();
        go(1);
        return;
      case 'End':
        event.preventDefault();
        go(total, CLICKS_MAX);
        return;
      case 'Escape':
        gotoClose();
        return;
      default:
        break;
    }
    const key = event.key.toLowerCase();
    if (key === 'o' || event.key === '`') toggleOverview();
    else if (key === 'g') gotoOpen();
    else if (key === 'f' && document.fullscreenEnabled) {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    }
  });

  window.addEventListener('hashchange', () => {
    const state = parseHash();
    if (state.no !== nav.no || state.click !== nav.click) go(state.no, state.click, { instant: true });
  });

  // ---------------------------------------------------------------- boot
  onNavChange(() => {
    updateNavBar();
    updateProgress();
    showDrawingsFor(nav.no);
    updateDrawingUi();
    renderPresenterExtras();
  });

  if (isPresenter) buildPresenter();

  if (total) {
    const initial = parseHash();
    nav.no = initial.no;
    nav.click = initial.click;
    render(null, { instant: true });
    if (!location.hash) writeHash();
  } else if (counterEl) {
    counterEl.querySelector('.current').textContent = '0';
    counterEl.querySelector('.total').textContent = ' / 0';
  }
  fitStage();

  // Stable hooks for export tooling: navigate and read deck state without UI.
  // go(n) lands on the slide's final click state with transitions disabled so
  // screenshots capture the fully-revealed slide.
  window.__deck = {
    count: total,
    current: () => nav.no,
    go: (slideNumber) => go(slideNumber, CLICKS_MAX, { instant: true, force: true }),
  };

  function themeStylesheet() {
    return Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .find((link) => new URL(link.href, location.href).pathname.endsWith('/theme.css'));
  }

  function swapThemeStylesheet() {
    return new Promise((resolve, reject) => {
      const current = themeStylesheet();
      if (!current) {
        reject(new Error('Theme stylesheet was not found'));
        return;
      }
      const replacement = current.cloneNode(false);
      replacement.href = `theme.css?v=${Date.now()}`;
      replacement.addEventListener('load', () => {
        current.remove();
        resolve();
      }, { once: true });
      replacement.addEventListener('error', () => {
        replacement.remove();
        reject(new Error('Theme stylesheet failed to reload'));
      }, { once: true });
      current.after(replacement);
    });
  }

  async function softResync(paths, { refreshTheme = false } = {}) {
    const previous = { ...nav };
    finishTransition();
    await loadDeck();
    if (refreshTheme || paths.has('theme.css')) await swapThemeStylesheet();

    nav.no = Math.min(Math.max(previous.no, 1), Math.max(total, 1));
    nav.click = total ? clampClick(nav.no, previous.click) : 0;
    if (!overview.hidden) {
      overview.hidden = true;
      overview.classList.remove('opening', 'closing');
    }
    window.__deck.count = total;
    if (total) render(previous, { instant: true });
    else {
      updateNavBar();
      updateProgress();
      renderPresenterExtras();
    }
    fitStage();
  }

  if (deckId && 'EventSource' in window) {
    const events = new EventSource(`/api/decks/${encodeURIComponent(deckId)}/runtime/events`);
    const pendingPaths = new Set();
    let pendingFull = false;
    let reloadTimer = 0;
    events.addEventListener('deck_changed', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!Array.isArray(payload.paths) || !payload.paths.length) pendingFull = true;
        else payload.paths.forEach((value) => {
          if (typeof value === 'string') pendingPaths.add(value.replace(/^\/+/, ''));
        });
      } catch {
        pendingFull = true;
      }
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        const paths = new Set(pendingPaths);
        const full = pendingFull;
        pendingPaths.clear();
        pendingFull = false;
        try {
          if (!full && paths.size > 0 && Array.from(paths).every((value) => value.endsWith('.css'))) {
            await swapThemeStylesheet();
          } else {
            // A no-paths event means "something changed"; refresh the theme
            // too since the server could not say whether it was touched.
            await softResync(paths, { refreshTheme: full });
          }
        } catch {
          location.reload();
        }
      }, 200);
    });
  }
})();
