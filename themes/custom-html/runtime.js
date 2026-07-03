/* Runtime shell script. Do not edit: deck content lives in deck.json, slides/, and theme.css. */
(async () => {
  const stage = document.querySelector('[data-stage]');
  const counter = document.querySelector('[data-counter]');
  const prevButton = document.querySelector('[data-prev]');
  const nextButton = document.querySelector('[data-next]');
  const indexButton = document.querySelector('[data-toggle-index]');
  const indexOverlay = document.querySelector('[data-index]');
  const indexList = document.querySelector('[data-index-list]');

  const STAGE_WIDTH = 1280;
  const STAGE_HEIGHT = 720;

  let manifest = { title: 'Deck', slides: [] };
  try {
    const response = await fetch('deck.json', { cache: 'no-store' });
    if (response.ok) manifest = await response.json();
  } catch {
    /* fall through to empty deck */
  }
  if (manifest.title) document.title = manifest.title;

  const slidePaths = Array.isArray(manifest.slides) ? manifest.slides : [];
  const fragments = await Promise.all(slidePaths.map(async (slidePath) => {
    try {
      const response = await fetch(slidePath, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      return await response.text();
    } catch {
      return `<section class="slide slide-error"><h2>Missing slide</h2><p>${slidePath}</p></section>`;
    }
  }));

  const parser = new DOMParser();
  const slides = fragments.map((fragment, slideIndex) => {
    const doc = parser.parseFromString(fragment, 'text/html');
    let section = doc.body.querySelector('section.slide');
    if (!section) {
      section = doc.createElement('section');
      section.className = 'slide';
      while (doc.body.firstChild) section.appendChild(doc.body.firstChild);
    }
    section.dataset.slideIndex = String(slideIndex);
    stage.appendChild(document.importNode(section, true));
    return stage.lastElementChild;
  });

  let index = initialIndex();

  function initialIndex() {
    const value = Number(String(location.hash).replace(/^#\/?/, ''));
    if (Number.isInteger(value) && value > 0) return Math.min(value - 1, Math.max(slides.length - 1, 0));
    return 0;
  }

  function slideTitle(slide, slideIndex) {
    return slide.dataset.title
      || slide.querySelector('h1, h2, h3')?.textContent?.trim()
      || `Slide ${slideIndex + 1}`;
  }

  function show(nextIndex, pushHash = true) {
    if (!slides.length) {
      if (counter) counter.textContent = '0 / 0';
      return;
    }
    index = Math.min(Math.max(nextIndex, 0), slides.length - 1);
    slides.forEach((slide, slideIndex) => {
      const isActive = slideIndex === index;
      slide.classList.toggle('is-active', isActive);
      slide.style.display = isActive ? '' : 'none';
      slide.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });
    if (counter) counter.textContent = `${index + 1} / ${slides.length}`;
    if (pushHash) history.replaceState(null, '', `#/${index + 1}`);
    indexList?.querySelectorAll('li').forEach((item, itemIndex) => {
      item.classList.toggle('is-current', itemIndex === index);
    });
  }

  function move(delta) {
    show(index + delta);
  }

  function toggleIndex(force) {
    if (!indexOverlay) return;
    const shouldShow = force ?? indexOverlay.hidden;
    indexOverlay.hidden = !shouldShow;
  }

  if (indexList) {
    slides.forEach((slide, slideIndex) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = slideTitle(slide, slideIndex);
      button.addEventListener('click', () => {
        toggleIndex(false);
        show(slideIndex);
      });
      item.appendChild(button);
      indexList.appendChild(item);
    });
  }

  function fitStage() {
    const scale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
    stage.style.transform = `scale(${scale})`;
  }

  prevButton?.addEventListener('click', () => move(-1));
  nextButton?.addEventListener('click', () => move(1));
  indexButton?.addEventListener('click', () => toggleIndex());
  indexOverlay?.addEventListener('click', (event) => {
    if (event.target === indexOverlay) toggleIndex(false);
  });
  window.addEventListener('resize', fitStage);
  window.addEventListener('hashchange', () => show(initialIndex(), false));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      toggleIndex(false);
      return;
    }
    if (indexOverlay && !indexOverlay.hidden) return;
    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      move(1);
    }
    if (['ArrowLeft', 'PageUp', 'Backspace'].includes(event.key)) {
      event.preventDefault();
      move(-1);
    }
    if (event.key === 'Home') show(0);
    if (event.key === 'End') show(slides.length - 1);
    if (event.key.toLowerCase() === 'g') toggleIndex();
  });

  fitStage();
  show(index, !location.hash);

  // Stable hooks for export tooling: navigate and read deck state without UI.
  window.__deck = {
    count: slides.length,
    current: () => index + 1,
    go: (slideNumber) => show(slideNumber - 1),
  };

  const deckId = location.pathname.match(/^\/runtime\/([^/]+)/)?.[1];
  if (deckId && 'EventSource' in window) {
    const events = new EventSource(`/api/decks/${encodeURIComponent(deckId)}/runtime/events`);
    events.addEventListener('deck_changed', () => {
      location.reload();
    });
  }
})();
