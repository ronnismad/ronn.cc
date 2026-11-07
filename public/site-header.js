/* Keep anchor targets clear of the header as viewport, fonts and language change. */
(() => {
  const header = document.querySelector('body > .site-header, .home-primary');
  if (!header) return;
  const updateOffset = () => {
    const top = parseFloat(getComputedStyle(header).top) || 0;
    document.documentElement.style.setProperty('--site-header-offset', `${Math.ceil(header.getBoundingClientRect().height + top + 16)}px`);
  };
  updateOffset();
  if ('ResizeObserver' in window) new ResizeObserver(updateOffset).observe(header);
  window.addEventListener('resize', updateOffset, { passive: true });
  document.fonts?.ready.then(updateOffset);
})();
