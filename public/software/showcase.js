(() => {
  const track = document.querySelector('[data-software-track]');
  if (!track) return;
  const cards = [...track.querySelectorAll('.soft-slot')];
  const picker = document.querySelector('[data-app-picker]');
  const previous = document.querySelector('[data-software-previous]');
  const next = document.querySelector('[data-software-next]');
  const position = document.querySelector('[data-software-position]');
  let active = 0;

  function stops() {
    const end = track.scrollWidth - track.clientWidth;
    return cards.map(card => Math.min(end, card.offsetLeft - cards[0].offsetLeft));
  }

  function render(index) {
    active = index;
    picker.value = cards[index].id;
    previous.disabled = index === 0;
    next.disabled = index === cards.length - 1;
    cards.forEach((card, i) => card.classList.toggle('is-selected', i === index));
    const value = (index + 1) + ' / ' + cards.length;
    if (position.textContent !== value) position.textContent = value;
  }

  function choose(index, updateLink = false) {
    if (index < 0 || index >= cards.length) return;
    render(index);
    track.scrollTo({ left: stops()[index], behavior: 'instant' });
    if (updateLink) history.replaceState(null, '', '#' + cards[index].id);
  }

  function followHash() {
    const index = cards.findIndex(card => '#' + card.id === location.hash);
    if (index >= 0) choose(index);
  }

  function syncScroll() {
    const points = stops();
    const left = track.scrollLeft;
    // Two cards can share the last possible scroll position on a wide screen.
    // Keep an explicit selection when it is already fully in view.
    if (Math.abs(points[active] - left) <= 2) return;
    const nearest = Math.abs(left - points.at(-1)) <= 2 ? cards.length - 1 :
      points.reduce((best, x, i) => Math.abs(x - left) < Math.abs(points[best] - left) ? i : best, 0);
    if (nearest !== active) {
      render(nearest);
      if (location.hash.startsWith('#app-')) history.replaceState(null, '', '#' + cards[nearest].id);
    }
  }

  picker.addEventListener('change', () => choose(cards.findIndex(card => card.id === picker.value), true));
  previous.addEventListener('click', () => choose(active - 1, true));
  next.addEventListener('click', () => choose(active + 1, true));
  track.addEventListener('keydown', event => {
    if (event.target !== track) return;
    const keys = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: cards.length - 1 };
    if (Object.hasOwn(keys, event.key)) {
      event.preventDefault();
      choose(keys[event.key], true);
    }
  });
  track.addEventListener('focusin', event => {
    const index = cards.indexOf(event.target.closest('.soft-slot'));
    if (index >= 0) choose(index);
  });
  track.addEventListener('scroll', syncScroll, { passive: true });
  window.addEventListener('hashchange', followHash);
  window.addEventListener('pageshow', followHash);
  new ResizeObserver(() => choose(active)).observe(track);
  picker.closest('label').hidden = false;
  document.querySelector('.showcase-controls').hidden = false;
  render(active);
  followHash();
})();
