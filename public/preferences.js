(() => {
  const dictionary = window.RONN_LOCALES || {};
  const saved = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const requested = new URL(location.href).searchParams.get('lang');
  let language = ['en','ru','zh'].includes(requested) ? requested : saved('ronn-language') || 'en';
  if (!['en','ru','zh'].includes(language)) language = 'en';
  const controls = document.querySelector('.site-preferences');
  const select = controls?.querySelector('select');
  const toggle = controls?.querySelector('button');
  const originals = new WeakMap();
  const attributes = new WeakMap();
  const links = new WeakMap();
  document.querySelectorAll('select option').forEach(option => {
    if (!option.hasAttribute('value')) option.value = option.textContent;
  });
  const t = source => {
    if (language === 'en') return source;
    const index = language === 'ru' ? 0 : 1;
    if (dictionary[source]) return dictionary[source][index];
    const patterns = [
      [/^(\d+) milestones$/, n => index === 0 ? `Этапы: ${n}` : `${n} 个经历节点`],
      [/^(\d+) tracks?$/, n => index === 0 ? `Записи: ${n}` : `${n} 首曲目`],
      [/^(\d+) of (\d+) publication entries shown$/, (a,b) => index === 0 ? `Показано ${a} из ${b} записей` : `显示 ${b} 条文献中的 ${a} 条`],
      [/^(Play|Pause) (.+)$/, (verb,name) => `${t(verb)} ${name}`],
      [/^Copy citation for (.+)$/, name => `${t('Copy citation')} · ${t(name)}`],
      [/^for (.+)$/, name => `${index === 0 ? 'для' : '：'} ${t(name)}`],
      [/^Could not copy automatically\. Please select and copy: (.+)$/, text => `${index === 0 ? 'Не удалось скопировать автоматически. Выделите и скопируйте:' : '无法自动复制，请选中并复制：'} ${text}`]
    ];
    for (const [pattern,format] of patterns) { const match = source.match(pattern); if (match) return format(...match.slice(1)); }
    return source;
  };
  function translated(value) {
    const parts = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return parts[1] + t(parts[2].replace(/\s+/g,' ')) + parts[3];
  }
  const excluded = element => element?.closest('script,style,svg,code,pre,textarea,[translate="no"],.site-preferences');
  let observer;
  function render() {
    observer?.disconnect();
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : language;
    const walker = document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (excluded(node.parentElement) || !node.nodeValue.trim()) continue;
      let record = originals.get(node);
      if (!record || node.nodeValue !== record.last) record = { source: node.nodeValue };
      const value = language === 'en' ? record.source : translated(record.source);
      if (node.nodeValue !== value) node.nodeValue = value;
      record.last = value; originals.set(node,record);
    }
    document.querySelectorAll('[aria-label],[title],[alt],[data-label]').forEach(element => {
      if (excluded(element)) return;
      let records = attributes.get(element);
      if (!records) { records = {}; attributes.set(element,records); }
      for (const attr of ['aria-label','title','alt','data-label']) {
        const value = element.getAttribute(attr);
        if (value === null) continue;
        let record = records[attr];
        if (!record || value !== record.last) record = { source: value };
        const output = language === 'en' ? record.source : translated(record.source);
        if (output !== value) element.setAttribute(attr,output);
        record.last = output; records[attr] = record;
      }
    });
    const title = document.querySelector('title');
    if (title) {
      let record = originals.get(title);
      if (!record) record = { source: title.textContent };
      title.textContent = t(record.source).replace(/^(CV|Science|Software|Audio|Contact|Not found|Hardware|Visual|Alternoid)( — Ronn)$/,(_,name,suffix)=>t(name)+suffix);
      if (language !== 'en' && record.source.includes('English Teaching')) title.textContent = language === 'ru' ? 'Ronnie — Преподаватель английского | Sutanu Chatterjee' : 'Ronnie — 英语教学 | Sutanu Chatterjee';
      originals.set(title,record);
    }
    document.querySelectorAll('a[href]').forEach(link => {
      if (link.hasAttribute('download')) return;
      let record = links.get(link);
      const current = link.getAttribute('href');
      if (!record || current !== record.last) record = { source: current };
      let output = record.source;
      try {
        const url = new URL(record.source,location.href);
        if (url.protocol === 'mailto:' && language !== 'en') {
          for (const param of ['subject','body']) if (url.searchParams.has(param)) url.searchParams.set(param,url.searchParams.get(param).split('\n').map(line=>t(line)).join('\n'));
          output = url.href;
        } else if (url.origin === location.origin && !record.source.startsWith('#') && !/\.[a-z0-9]+$/i.test(url.pathname)) {
          if (language === 'en') url.searchParams.delete('lang'); else url.searchParams.set('lang',language);
          output = url.pathname + url.search + url.hash;
        }
      } catch {}
      if (output !== current) link.setAttribute('href',output);
      record.last = output; links.set(link,record);
    });
    for (const meta of document.querySelectorAll('meta[name="description"],meta[property="og:description"],meta[property="og:title"]')) {
      let record = originals.get(meta);
      if (!record) record = { source: meta.content };
      meta.content = t(record.source); originals.set(meta,record);
    }
    const labels = {
      en: ['Site language','Switch to light mode','Switch to dark mode','Appearance and language'],
      ru: ['Язык сайта','Включить светлую тему','Включить тёмную тему','Тема и язык'],
      zh: ['网站语言','切换为浅色模式','切换为深色模式','外观和语言']
    }[language];
    if (select) { select.value = language; select.setAttribute('aria-label',labels[0]); }
    if (controls) controls.setAttribute('aria-label',labels[3]);
    const light = document.documentElement.dataset.theme === 'light';
    if (toggle) {
      toggle.setAttribute('aria-label',labels[light ? 2 : 1]);
      toggle.title = labels[light ? 2 : 1];
      toggle.setAttribute('aria-pressed',String(light));
      toggle.querySelector('[data-theme-icon]').textContent = light ? '☾' : '☼';
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',light ? '#dce1d5' : '#17191a');
    observer?.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','alt','title','data-label']});
  }
  let queued = false;
  observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  });
  select?.addEventListener('change',() => {
    language = select.value;
    save('ronn-language',language);
    const url = new URL(location.href);
    if (language === 'en') url.searchParams.delete('lang'); else url.searchParams.set('lang',language);
    history.replaceState(null,'',url);
    render();
  });
  toggle?.addEventListener('click',() => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    save('ronn-theme',theme); render();
  });
  render();
})();
