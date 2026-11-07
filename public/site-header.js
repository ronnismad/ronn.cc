/* Keep anchor targets clear of the header as viewport, fonts and language change. */
(() => {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const nav = header.querySelector('.nav, .home-primary');
  const mobile = matchMedia('(max-width: 640px)');
  if (nav) {
    nav.id ||= 'site-navigation';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'site-menu-toggle';
    toggle.setAttribute('aria-controls', nav.id);
    toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="menu-open-icon" d="M4 6h16M4 12h16M4 18h16"/><path class="menu-close-icon" d="m6 6 12 12M18 6 6 18"/></svg>';
    const setOpen = open => {
      header.dataset.menuOpen = String(open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    };
    setOpen(false);
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    header.append(toggle);
    header.dataset.menuReady = '';
    nav.addEventListener('click', event => { if (event.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && mobile.matches && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus({ preventScroll: true });
      }
    });
    document.addEventListener('pointerdown', event => {
      if (mobile.matches && !header.contains(event.target)) setOpen(false);
    });
    mobile.addEventListener('change', () => {
      setOpen(false);
      if (!mobile.matches && document.activeElement === toggle) nav.querySelector('a')?.focus({ preventScroll: true });
    });
  }
  const updateOffset = () => {
    const surface = getComputedStyle(header).display === 'contents' && nav ? nav : header;
    const top = parseFloat(getComputedStyle(surface).top) || 0;
    document.documentElement.style.setProperty('--site-header-offset', `${Math.ceil(surface.getBoundingClientRect().height + top + 16)}px`);
  };
  updateOffset();
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(updateOffset);
    observer.observe(header);
    if (nav) observer.observe(nav);
  }
  window.addEventListener('resize', updateOffset, { passive: true });
  document.fonts?.ready.then(updateOffset);
})();
