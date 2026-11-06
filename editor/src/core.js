/* HTML PPT's document adapter, command history, and local draft store. */
(() => {
  'use strict';
  const OBJECTS = '.para,.diagram,.figure,.code-panel,.table-wrap,.code-label,.queue-note,[data-editable],.ppt-object';
  const ATOMIC = '.diagram,.figure,.code-panel,.table-wrap,[data-editable],.ppt-object';
  const uid = () => {
    // randomUUID requires HTTPS/localhost; LAN HTTP still has getRandomValues.
    if (globalThis.crypto?.randomUUID) return 'ppt-' + crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return 'ppt-' + [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const resourceUrl = (url, base) => {
    if (!base || !url || /^(?:#|data:|blob:)/i.test(url)) return url;
    try { return new URL(url, base).href; } catch { return url; }
  };
  const resourceCss = (css, base) => !base ? css : css.replace(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/g, (_, quote, url) => `url("${resourceUrl(url, base).replace(/"/g, '%22')}")`);
  function resolveResources(root, base) {
    if (!base) return root;
    [root, ...root.querySelectorAll('*')].forEach(el => {
      for (const attr of ['src', 'href', 'xlink:href', 'poster']) {
        if (el.hasAttribute(attr)) el.setAttribute(attr, resourceUrl(el.getAttribute(attr), base));
      }
      if (el.hasAttribute('style')) el.setAttribute('style', resourceCss(el.getAttribute('style'), base));
      if (el.tagName?.toLowerCase() === 'style') el.textContent = resourceCss(el.textContent, base);
    });
    return root;
  }
  const cleanText = el => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('.marker,.sparkle,.number-star,style,script').forEach(n => n.remove());
    return copy.textContent.trim();
  };
  function sanitize(root) {
    root.querySelectorAll('script,iframe,object,embed,base,meta[http-equiv],link[rel="import"]').forEach(n => n.remove());
    const nodes = [root, ...root.querySelectorAll('*')];
    for (const el of nodes) {
      if (!el.attributes) continue;
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name) || attr.name === 'srcdoc' ||
          (/^(href|xlink:href|action|formaction)$/i.test(attr.name) && /^\s*(javascript|vbscript):/i.test(attr.value))) el.removeAttribute(attr.name);
      }
    }
    return root;
  }
  function clearEditing(root) {
    root.querySelectorAll('[data-ppt-text-editor]').forEach(n => n.replaceWith(...n.childNodes));
    [root, ...root.querySelectorAll('*')].forEach(el => {
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-ppt-active');
    });
    root.classList.remove('active');
    root.removeAttribute('aria-hidden');
    root.removeAttribute('inert');
    return root;
  }
  const serializeSlide = slide => clearEditing(slide.cloneNode(true)).outerHTML;
  const kind = el => el.matches('.diagram,.figure,img,svg') || el.querySelector('svg,img') ? 'image' : el.matches('.table-wrap,table') ? 'table' : 'text';
  const imageKind = el => kind(el) === 'image';
  const number = (s, fallback = 0) => Number.isFinite(parseFloat(s)) ? parseFloat(s) : fallback;
  const offset = el => {
    const parts = (el.style.translate || '0 0').split(/\s+/);
    return {x: number(parts[0]), y: number(parts[1])};
  };
  const scaling = el => {
    const parts = (el.style.scale || '1 1').split(/\s+/);
    return {x: number(parts[0], 1), y: number(parts[1], number(parts[0], 1))};
  };

  class DeckDocument {
    constructor(html, filename = 'presentation.html') {
      if (typeof html !== 'string' || html.length > 60_000_000) throw new Error('HTML 为空或文件超过 60 MB');
      this.doc = new DOMParser().parseFromString(html, 'text/html');
      this.filename = filename;
      this.resourceBase = null;
      this.slides = [...this.doc.querySelectorAll('.slide')];
      if (!this.slides.length) throw new Error('没有找到 .slide 页面；请打开当前框架生成的 HTML PPT');
      let config = {};
      try { config = JSON.parse(this.doc.getElementById('deck-config')?.textContent || '{}'); } catch { /* Inline dimensions also work. */ }
      this.width = number(config.width, number(this.slides[0].style.width, 960));
      this.height = number(config.height, number(this.slides[0].style.height, 540));
      if (this.width < 100 || this.height < 100 || this.width > 8000 || this.height > 8000) throw new Error('画布尺寸超出支持范围');
      this.title = this.doc.title || filename.replace(/\.html?$/i, '');
      const seen = new Set();
      for (const slide of this.slides) {
        for (const el of slide.querySelectorAll(OBJECTS)) {
          if (el.closest('[data-role="page-number"],.background') || el.parentElement.closest(ATOMIC)) continue;
          let id = el.dataset.pptId;
          if (!id || seen.has(id)) id = uid();
          el.dataset.pptId = id;
          seen.add(id);
        }
      }
    }
    label(index) {
      const slide = this.slides[index];
      return cleanText(slide.querySelector('[data-role="title"]') || slide).slice(0, 90) || `幻灯片 ${index + 1}`;
    }
    editorHtml() {
      const clone = this.doc.cloneNode(true);
      sanitize(clone);
      clone.querySelectorAll('.toolbar,.qa-banner').forEach(n => n.remove());
      clone.body.classList.remove('overview');
      for (const slide of clone.querySelectorAll('.slide')) clearEditing(slide);
      const css = clone.createElement('style');
      css.textContent = `
        html,body{margin:0!important;width:${this.width}px!important;height:${this.height}px!important;overflow:hidden!important;background:white!important}
        .slide{display:none!important;position:absolute!important;transform:none!important;left:0!important;top:0!important;margin:0!important}
        .slide[data-ppt-active]{display:block!important}
        [data-ppt-id]{cursor:default;touch-action:none}
        [data-ppt-text-editor]{outline:none;cursor:text;white-space:pre-wrap;user-select:text;touch-action:auto}
        .marker{user-select:none}
      `;
      clone.head.append(css);
      if (this.resourceBase) {
        const base = clone.createElement('base'); base.href = this.resourceBase; clone.head.prepend(base);
      }
      return '<!doctype html>\n' + clone.documentElement.outerHTML;
    }
    snapshot(frameDoc, index) { return serializeSlide(frameDoc.querySelectorAll('.slide')[index]); }
    update(index, html) {
      const template = this.doc.createElement('template');
      template.innerHTML = html;
      const slide = template.content.firstElementChild;
      if (!slide?.matches('.slide')) throw new Error('页面数据无效');
      this.slides[index].replaceWith(slide);
      this.slides[index] = slide;
    }
    restore(frameDoc, index, html) {
      this.update(index, html);
      const old = frameDoc.querySelectorAll('.slide')[index];
      old.replaceWith(sanitize(frameDoc.importNode(this.slides[index], true)));
    }
    html({project = false} = {}) {
      const clone = this.doc.cloneNode(true);
      clone.body.classList.remove('overview');
      clone.querySelectorAll('.qa-banner').forEach(n => n.remove());
      for (const slide of clone.querySelectorAll('.slide')) {
        clearEditing(slide);
        for (const prop of ['transform', 'left', 'top']) slide.style.removeProperty(prop);
        if (!project) for (const el of slide.querySelectorAll('[data-ppt-id]')) el.removeAttribute('data-ppt-id');
      }
      const qa = clone.getElementById('deck-qa');
      if (qa) { qa.textContent = '{}'; qa.removeAttribute('data-ready'); }
      const toolbar = clone.querySelector('.toolbar');
      if (toolbar) toolbar.hidden = false;
      if (!project && window.HtmlPptRuntime) {
        // The original placeholder audit assumes its old flow geometry. A visual
        // edit may deliberately move an object outside that placeholder. Exports
        // validate against the page canvas and retain the existing deck controls.
        clone.querySelectorAll('script:not([type="application/json"])').forEach(n => n.remove());
        if (!clone.getElementById('deck-config')) {
          const config = clone.createElement('script'); config.id = 'deck-config'; config.type = 'application/json';
          config.textContent = JSON.stringify({width: this.width, height: this.height, font_faces: []}); clone.body.append(config);
        }
        const runtime = clone.createElement('script'); runtime.id = 'ppt-runtime';
        runtime.textContent = '(' + window.HtmlPptRuntime.toString() + ')();'; clone.body.append(runtime);
      }
      return '<!doctype html>\n' + clone.documentElement.outerHTML;
    }
    project() {
      return {format: 'html-ppt-project', version: 1, filename: this.filename, title: this.title,
        updatedAt: new Date().toISOString(), html: this.html({project: true})};
    }
    static fromProject(project) {
      if (project?.format !== 'html-ppt-project' || project.version !== 1 || typeof project.html !== 'string') throw new Error('不是受支持的 HTML PPT 项目文件');
      return new DeckDocument(project.html, project.filename || 'presentation.html');
    }
  }

  class History {
    constructor(limit = 60) { this.limit = limit; this.entries = []; this.cursor = 0; }
    push(entry) {
      if (entry.before === entry.after) return false;
      this.entries.splice(this.cursor);
      this.entries.push(entry);
      if (this.entries.length > this.limit) this.entries.shift();
      this.cursor = this.entries.length;
      return true;
    }
    undo() { return this.cursor ? this.entries[--this.cursor] : null; }
    redo() { return this.cursor < this.entries.length ? this.entries[this.cursor++] : null; }
    get canUndo() { return this.cursor > 0; }
    get canRedo() { return this.cursor < this.entries.length; }
  }

  class DraftStore {
    async open() {
      if (this.db) return this.db;
      this.db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('html-ppt-studio', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('drafts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('草稿数据库被另一个窗口占用'));
      });
      return this.db;
    }
    async read(key = 'current') {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const req = db.transaction('drafts').objectStore('drafts').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    async write(project, key = 'current') {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put(project, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('草稿保存中断'));
      });
    }
  }

  window.HtmlPpt = {DeckDocument, History, DraftStore, cleanText, sanitize, clearEditing, serializeSlide, kind, imageKind, number, offset, scaling, uid, resourceCss, resolveResources};
})();
