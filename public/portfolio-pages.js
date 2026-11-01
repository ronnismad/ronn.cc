(() => {
  const filterPanel = document.querySelector('[data-publication-filters]');
  if (filterPanel) {
    const filters = [...filterPanel.querySelectorAll('select')];
    const publications = [...document.querySelectorAll('[data-publication]')];
    const count = document.querySelector('[data-publication-count]');
    const empty = document.querySelector('[data-publication-empty]');
    const update = () => {
      let shown = 0;
      publications.forEach(entry => {
        const matches = filters.every(select => !select.value || entry.dataset[select.dataset.filter] === select.value);
        entry.hidden = !matches;
        if (matches) shown++;
      });
      count.textContent = `${shown} of ${publications.length} publication entries shown`;
      empty.hidden = shown !== 0;
    };
    filters.forEach(select => select.addEventListener('change', update));
    filterPanel.hidden = false;
    update();
  }
  document.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
      const status = document.getElementById(button.dataset.status);
      const text = button.dataset.copy;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        status.textContent = button.dataset.success || 'Copied.';
      } catch {
        status.textContent = `Could not copy automatically. Please select and copy: ${text}`;
      }
    });
  });
})();
