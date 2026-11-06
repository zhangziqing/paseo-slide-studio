/* Bundled into exports; editing and presentation use the same HTML objects. */
window.HtmlPptRuntime = function presentationRuntime() {
  'use strict';
  const config = JSON.parse(document.getElementById('deck-config').textContent);
  const slides = [...document.querySelectorAll('.slide')];
  const capture = new URLSearchParams(location.search).has('capture');
  let index = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));
  let toolbar = document.querySelector('.toolbar');
  if (!toolbar) {
    toolbar = document.createElement('nav'); toolbar.className = 'toolbar';
    toolbar.setAttribute('aria-label', '演示控制'); document.body.append(toolbar);
  }
  for (const [id, text] of [['prev', '上一页'], ['position', ''], ['next', '下一页'], ['overview', '总览'], ['fullscreen', '全屏']]) {
    if (document.getElementById(id)) continue;
    const node = document.createElement(id === 'position' ? 'span' : 'button'); node.id = id; node.textContent = text; toolbar.append(node);
  }
  toolbar.hidden = capture;
  function fit() {
    const scale = capture ? 1 : Math.max(.05, Math.min(innerWidth / config.width, (innerHeight - 50) / config.height));
    slides.forEach(slide => {
      slide.style.transform = `scale(${scale})`;
      slide.style.left = capture ? '0px' : (innerWidth - config.width * scale) / 2 + 'px';
      slide.style.top = capture ? '0px' : Math.max(0, (innerHeight - 50 - config.height * scale) / 2) + 'px';
    });
  }
  function show(n) {
    index = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((slide, i) => {
      const visible = document.body.classList.contains('overview') || i === index;
      slide.classList.toggle('active', i === index); slide.inert = !visible;
      slide.setAttribute('aria-hidden', String(!visible));
    });
    document.getElementById('position').textContent = `${index + 1} / ${slides.length}`;
    try { history.replaceState(null, '', '#' + (index + 1)); } catch { /* An embedded browser can forbid history changes. */ }
    fit();
  }
  function audit() {
    const issues = [];
    slides.forEach((slide, page) => {
      const style = slide.getAttribute('style'), active = slide.classList.contains('active');
      slide.classList.add('active'); Object.assign(slide.style, {transform: 'none', left: '0px', top: '0px'});
      const sr = slide.getBoundingClientRect();
      slide.querySelectorAll('.para,.code-panel,.diagram,.figure,.table-wrap,.ppt-object,.code-label,.queue-note').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.left < sr.left - 1 || r.top < sr.top - 1 || r.right > sr.left + config.width + 1 || r.bottom > sr.top + config.height + 1) issues.push({page: page + 1, kind: 'bounds', text: el.textContent.slice(0, 80)});
        if (el.matches('.para,.code-panel,.ppt-object:not(:has(img))') && (el.scrollWidth > el.clientWidth + 2 || (el.style.height && el.scrollHeight > el.clientHeight + 2))) issues.push({page: page + 1, kind: 'text-overflow', text: el.textContent.slice(0, 80)});
      });
      slide.querySelectorAll('img').forEach(img => { if (!img.complete || !img.naturalWidth) issues.push({page: page + 1, kind: 'image', message: 'Image failed to decode'}); });
      if (style === null) slide.removeAttribute('style'); else slide.setAttribute('style', style);
      slide.classList.toggle('active', active);
    });
    return issues;
  }
  window.deck = {show, audit, config, count: slides.length, get index() { return index; }};
  document.getElementById('prev').onclick = () => show(index - 1);
  document.getElementById('next').onclick = () => show(index + 1);
  document.getElementById('overview').onclick = () => { document.body.classList.toggle('overview'); show(index); };
  document.getElementById('fullscreen').onclick = () => {
    const result = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); result.catch(() => {});
  };
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.isContentEditable || e.target.closest('input,textarea,select,a,button')) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(index + 1); }
    if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); show(index - 1); }
    if (e.key === 'Home') { e.preventDefault(); show(0); }
    if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
    if (e.key.toLowerCase() === 'f') document.getElementById('fullscreen').click();
  });
  addEventListener('hashchange', () => show((parseInt(location.hash.slice(1), 10) || 1) - 1));
  addEventListener('resize', fit);
  addEventListener('beforeprint', () => slides.forEach(slide => { slide.inert = false; slide.setAttribute('aria-hidden', 'false'); }));
  addEventListener('afterprint', () => show(index));
  show(index);
  window.deckReady = (async () => {
    const fonts = await Promise.all((config.font_faces || []).map(async (face, i) => {
      const source = face.source || (face.local || []).map(n => `local(${JSON.stringify(n)})`).join(',');
      try { await new FontFace('ExportProbe' + i, source, {weight: String(face.weight)}).load(); return {family: face.family, weight: face.weight, loaded: true}; }
      catch { return {family: face.family, weight: face.weight, loaded: false}; }
    }));
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const issues = [...audit(), ...fonts.filter(font => !font.loaded).map(font => ({kind: 'font', ...font}))];
    const report = {status: issues.length ? 'failed' : 'passed', pages: slides.length, issues, fonts,
      visual_review: 'not_performed', font_glyph_coverage: 'not_verified_after_editing', user_agent: navigator.userAgent};
    const qa = document.getElementById('deck-qa');
    if (qa) { qa.textContent = JSON.stringify(report); qa.dataset.ready = 'true'; }
    if (issues.length && !capture) {
      const banner = document.createElement('div'); banner.className = 'qa-banner';
      banner.textContent = `检测到 ${issues.length} 项排版或资源问题，请检查页面。`; document.body.append(banner);
    }
    return report;
  })();
};
