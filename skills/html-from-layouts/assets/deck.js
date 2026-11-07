(() => {
  'use strict';
  const config = JSON.parse(document.getElementById('deck-config').textContent);
  const slides = [...document.querySelectorAll('.slide')];
  const params = new URLSearchParams(location.search);
  const capture = params.has('capture');
  let index = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));
  function fit() {
    const scale = capture ? 1 : Math.min(innerWidth / config.width, (innerHeight - 50) / config.height);
    slides.forEach(s => {
      s.style.transform = `scale(${Math.max(.05, scale)})`;
      s.style.left = capture ? '0px' : `${(innerWidth - config.width * scale) / 2}px`;
      s.style.top = capture ? '0px' : `${Math.max(0,(innerHeight - 50 - config.height * scale) / 2)}px`;
    });
  }
  function show(n) {
    index = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, i) => { s.classList.toggle('active', i === index); s.setAttribute('aria-hidden', String(i !== index)); s.inert = i !== index; });
    document.getElementById('position').textContent = `${index + 1} / ${slides.length}`;
    history.replaceState(null, '', `${location.pathname}${location.search}#${index + 1}`);
    fit();
  }
  function audit() {
    const issues = [];
    const old = index;
    slides.forEach((s, i) => {
      s.classList.add('active'); s.style.transform = 'none'; s.style.left = '0px'; s.style.top = '0px';
      s.querySelectorAll('.placeholder').forEach(box => {
        const r = box.getBoundingClientRect();
        const flow = box.querySelector('.flow');
        if (flow && (flow.scrollHeight > box.clientHeight + 1 || flow.scrollWidth > box.clientWidth + 1)) {
          issues.push({page: i + 1, kind: 'overflow', region: box.dataset.role, message: 'Content exceeds template placeholder'});
        }
        const nodes = box.querySelectorAll('.para,.code-panel,.table-wrap,.figure');
        nodes.forEach(el => {
          const c = el.getBoundingClientRect();
          if (c.left < r.left - 1 || c.right > r.right + 1 || c.top < r.top - 1 || c.bottom > r.bottom + 1 || el.scrollWidth > el.clientWidth + 1) {
            issues.push({page: i + 1, kind: 'overflow', region: box.dataset.role, text: el.textContent.slice(0, 100)});
          }
        });
      });
      s.querySelectorAll('img').forEach(img => { if (!img.complete || !img.naturalWidth) issues.push({page: i + 1, kind: 'image', message: 'Image failed to decode'}); });
      s.classList.remove('active');
    });
    show(old);
    return issues;
  }
  window.deck = {show, audit, config, count: slides.length, get index() { return index; }};
  document.getElementById('prev').onclick = () => show(index - 1);
  document.getElementById('next').onclick = () => show(index + 1);
  document.getElementById('fullscreen').onclick = () => {
    const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    action.catch(() => {});
  };
  document.getElementById('overview').onclick = () => {
    document.body.classList.toggle('overview');
    slides.forEach(s => { s.inert = !document.body.classList.contains('overview') && !s.classList.contains('active'); s.setAttribute('aria-hidden', String(s.inert)); });
  };
  addEventListener('keydown', e => {
    const target = e.target instanceof Element ? e.target : document.body;
    if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable || target.closest('a,button')) return;
    if (['ArrowRight','ArrowDown','PageDown',' '].includes(e.key)) { e.preventDefault(); show(index + 1); }
    if (['ArrowLeft','ArrowUp','PageUp'].includes(e.key)) { e.preventDefault(); show(index - 1); }
    if (e.key === 'Home') { e.preventDefault(); show(0); }
    if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
    if (e.key.toLowerCase() === 'f') document.getElementById('fullscreen').click();
  });
  addEventListener('hashchange', () => show((parseInt(location.hash.slice(1), 10) || 1) - 1));
  addEventListener('resize', fit);
  addEventListener('beforeprint', () => slides.forEach(s => { s.inert = false; s.setAttribute('aria-hidden', 'false'); }));
  addEventListener('afterprint', () => show(index));
  if (capture) document.querySelector('.toolbar').hidden = true;
  show(index);
  window.deckReady = (async () => {
    const fontResults = await Promise.all(config.font_faces.map(async (face, i) => {
      const source = face.source || face.local.map(n => `local(${JSON.stringify(n)})`).join(',');
      const f = new FontFace(`Probe${i}`, source, {weight: String(face.weight)});
      try { await f.load(); return {family: face.family, weight: face.weight, loaded: true}; }
      catch (_) { return {family: face.family, weight: face.weight, loaded: false}; }
    }));
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => {
      if (!capture) return img.decode().catch(() => {});
      // Virtual-time DOM capture can finish before compositor decode promises.
      if (img.complete) return;
      return new Promise(resolve => {
        img.addEventListener('load', resolve, {once: true});
        img.addEventListener('error', resolve, {once: true});
      });
    }));
    // audit() forces layout once fonts and image dimensions are available.
    await new Promise(resolve => capture ? setTimeout(resolve, 0) : requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const issues = audit();
    fontResults.filter(f => !f.loaded).forEach(f => issues.push({kind: 'font', ...f, message: 'Required real font face unavailable'}));
    const report = {status: issues.length ? 'failed' : 'passed', pages: slides.length, issues, fonts: fontResults,
      visual_review: 'not_performed', font_binary_identity: config.embedded_fonts ? 'embedded_source_hashes_in_manifest' : 'not_verified', user_agent: navigator.userAgent};
    const data = document.getElementById('deck-qa'); data.textContent = JSON.stringify(report).split('<').join(String.fromCharCode(92) + 'u003c'); data.dataset.ready = 'true';
    if (issues.length && !capture) {
      const banner = document.createElement('div'); banner.className = 'qa-banner';
      banner.textContent = `检测到 ${issues.length} 项排版或资源问题，请查看校验报告。`;
      document.body.append(banner);
    }
    return report;
  })();
})();
