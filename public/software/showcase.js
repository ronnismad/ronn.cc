(() => {
  const track = document.querySelector('[data-software-track]');
  if (!track) return;
  const previous = document.querySelector('[data-software-previous]');
  const next = document.querySelector('[data-software-next]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cards = [...track.querySelectorAll('.soft-slot')];
  const position = document.querySelector('[data-software-position]');
  const positions = () => cards.map(card => card.offsetLeft - cards[0].offsetLeft);
  function update() {
    previous.disabled = track.scrollLeft < 2;
    next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    if (position) {
      const stops = positions();
      const active = stops.reduce((closest, left, index) =>
        Math.abs(left - track.scrollLeft) < Math.abs(stops[closest] - track.scrollLeft) ? index : closest, 0);
      position.textContent = `${active + 1} / ${cards.length}`;
    }
  }
  function move(direction) {
    const stops = positions();
    const current = track.scrollLeft;
    const target = direction > 0
      ? stops.find(left => left > current + 8) ?? track.scrollWidth
      : stops.findLast(left => left < current - 8) ?? 0;
    track.scrollTo({ left: target, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
  }
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  track.addEventListener('keydown', event => {
    if (event.target !== track) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      move(event.key === 'ArrowRight' ? 1 : -1);
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      track.scrollTo({ left: event.key === 'Home' ? 0 : track.scrollWidth, behavior: 'instant' });
    }
  });
  track.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(track);
  document.querySelector('.showcase-controls').hidden = false;
  update();
})();
