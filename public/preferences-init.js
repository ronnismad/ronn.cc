(() => {
  let theme = 'dark';
  try { theme = localStorage.getItem('ronn-theme') || theme; } catch {}
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
})();
