(() => {
  const slides = Array.from(document.querySelectorAll('.slide'));
  const counter = document.querySelector('[data-counter]');
  const prevButton = document.querySelector('[data-prev]');
  const nextButton = document.querySelector('[data-next]');
  let index = initialIndex();

  function initialIndex() {
    const value = Number(String(location.hash).replace(/^#\/?/, ''));
    if (Number.isInteger(value) && value > 0) return Math.min(value - 1, Math.max(slides.length - 1, 0));
    return 0;
  }

  function show(nextIndex, pushHash = true) {
    if (!slides.length) return;
    index = Math.min(Math.max(nextIndex, 0), slides.length - 1);
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle('is-active', slideIndex === index);
      slide.setAttribute('aria-hidden', slideIndex === index ? 'false' : 'true');
    });
    if (counter) counter.textContent = `${index + 1} / ${slides.length}`;
    if (pushHash) history.replaceState(null, '', `#/${index + 1}`);
  }

  function move(delta) {
    show(index + delta);
  }

  prevButton?.addEventListener('click', () => move(-1));
  nextButton?.addEventListener('click', () => move(1));
  window.addEventListener('hashchange', () => show(initialIndex(), false));
  window.addEventListener('keydown', (event) => {
    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      move(1);
    }
    if (['ArrowLeft', 'PageUp', 'Backspace'].includes(event.key)) {
      event.preventDefault();
      move(-1);
    }
  });

  show(index, !location.hash);

  const deckId = location.pathname.match(/^\/runtime\/([^/]+)/)?.[1];
  if (deckId && 'EventSource' in window) {
    const events = new EventSource(`/api/decks/${encodeURIComponent(deckId)}/runtime/events`);
    events.addEventListener('deck_changed', () => {
      location.reload();
    });
  }
})();
