(() => {
  const grid = document.querySelector('.featured-grid');
  if (!grid) return;

  const enabled = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) and (forced-colors: none)');
  let listeners;
  let card;
  let frame;
  let x;
  let y;

  function clear() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (card) card.removeAttribute('data-spotlit');
    card = null;
  }

  function paint() {
    frame = 0;
    const bounds = card.getBoundingClientRect();
    card.style.setProperty('--spot-x', (x - bounds.left) + 'px');
    card.style.setProperty('--spot-y', (y - bounds.top) + 'px');
    card.setAttribute('data-spotlit', '');
  }

  function track(event) {
    const next = event.pointerType === 'mouse' && event.target.closest('.featured-project');
    if (next !== card) clear();
    if (!next) return;
    card = next;
    x = event.clientX;
    y = event.clientY;
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function sync() {
    listeners?.abort();
    clear();
    if (!enabled.matches) return;
    listeners = new AbortController();
    const options = { signal: listeners.signal, passive: true };
    grid.addEventListener('pointermove', track, options);
    grid.addEventListener('pointerleave', clear, options);
    grid.addEventListener('pointercancel', clear, options);
    document.addEventListener('keydown', clear, options);
    document.addEventListener('visibilitychange', clear, options);
    document.addEventListener('scroll', clear, { ...options, capture: true });
    window.addEventListener('resize', clear, options);
    window.addEventListener('blur', clear, options);
    window.addEventListener('pagehide', clear, options);
  }

  enabled.addEventListener('change', sync);
  sync();
})();
