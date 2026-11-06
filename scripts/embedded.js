/* Browser document bundled into the web adapter; file access uses Paseo RPC. */
(() => {
  'use strict';
  const namespace = 'paseo-slide-studio';
  const virtualOrigin = 'https://paseo-slide-studio.invalid';
  const marker = 'data-paseo-resources';
  const pending = new Map(), contexts = new Map();
  let nonce, sequence = 0, configuration, initialize;
  const initialized = new Promise(resolve => { initialize = resolve; });
  function send(type, fields = {}) { parent.postMessage({ namespace, nonce, type, ...fields }, '*'); }
  function theme(colors) {
    for (const [name, color] of Object.entries(colors || {})) {
      if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) && typeof color === 'string') document.documentElement.style.setProperty('--paseo-' + name, color);
    }
  }
  addEventListener('message', event => {
    const message = event.data;
    if (event.source !== parent || message?.namespace !== namespace) return;
    if (message.type === 'init' && !configuration && typeof message.nonce === 'string') {
      nonce = message.nonce; configuration = message; theme(message.colors); initialize(message); return;
    }
    if (!nonce || message.nonce !== nonce) return;
    if (message.type === 'theme') { theme(message.colors); return; }
    if (message.type !== 'response') return;
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result);
  });
  async function request(input) {
    await initialized;
    const id = ++sequence;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Paseo 文件请求超时，请检查主机连接后重试。')); }, 45000);
      pending.set(id, { resolve, reject, timer }); send('request', { id, request: input });
    });
    if (result.status < 200 || result.status >= 300) {
      const error = new Error(result.data?.error || '文件请求失败'); error.status = result.status; throw error;
    }
    return result.data;
  }
  addEventListener('pagehide', () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('编辑器已关闭。')); }
    pending.clear();
  });
  send('ready');

  const cssUrls = /url\(\s*(?:(["'])(.*?)\1|([^"'\s][^)]*?))\s*\)/gis;
  const cssImports = /@import\s+(["'])(.*?)\1/gi;
  function cssReferences(css) {
    return [...css.matchAll(cssUrls)].map(match => match[2] ?? match[3]).concat([...css.matchAll(cssImports)].map(match => match[2]));
  }
  function rewriteCss(css, replace) {
    return css.replace(cssUrls, (whole, quote, quoted, bare) => {
      const value = quoted ?? bare, next = replace(value);
      return next === value ? whole : 'url("' + next.replaceAll('"', '%22') + '")';
    }).replace(cssImports, (whole, quote, value) => {
      const next = replace(value); return next === value ? whole : '@import "' + next.replaceAll('"', '%22') + '"';
    });
  }
  function srcsetEntries(text) {
    const entries = []; let position = 0;
    while (position < text.length) {
      while (position < text.length && /[\s,]/.test(text[position])) position++;
      const start = position;
      while (position < text.length && !/\s/.test(text[position])) position++;
      let url = text.slice(start, position), descriptor = '';
      if (!url) break;
      if (url.endsWith(',')) url = url.replace(/,+$/, '');
      else {
        const rest = position; let nesting = 0;
        while (position < text.length) {
          const char = text[position];
          if (char === '(') nesting++; if (char === ')') nesting--;
          if (char === ',' && !nesting) break; position++;
        }
        descriptor = text.slice(rest, position).trim();
      }
      entries.push({ url, descriptor });
    }
    return entries;
  }
  function assetUrl(value, base) {
    if (!base || !value || /^(?:#|data:|blob:)/i.test(value)) return null;
    const url = new URL(value, base); return url.origin === virtualOrigin ? url : null;
  }
  function keyFor(url) { const key = new URL(url); key.hash = ''; return key.href; }
  const decode = base64 => new TextDecoder().decode(Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
  class Resources {
    constructor(base) { this.base = base; this.loading = new Map(); this.values = new Map(); this.styles = new Map(); }
    async load(value, base = this.base, ancestors = new Set()) {
      const url = assetUrl(value, base); if (!url) return value;
      const key = keyFor(url);
      if (ancestors.has(key)) return 'data:text/css,';
      if (!this.loading.has(key)) {
        const task = (async () => {
          if (!url.pathname.startsWith('/files/')) throw new Error('资源超出工作区：' + value);
          const path = decodeURIComponent(url.pathname.slice('/files/'.length));
          let result;
          try { result = await request({ method: 'asset', path }); }
          catch (error) { throw new Error('资源 ' + path + '：' + error.message); }
          let rendered = 'data:' + result.mime + ';base64,' + result.base64;
          if (result.mime === 'text/css') {
            const css = decode(result.base64), chain = new Set([...ancestors, key]);
            const references = cssReferences(css), replacements = new Map();
            // Sequential traversal prevents circular CSS imports waiting on each other.
            for (const reference of references) replacements.set(reference, await this.load(reference, key, chain));
            const resolved = rewriteCss(css, reference => replacements.get(reference) ?? reference);
            this.styles.set(key, resolved); rendered = 'data:text/css;charset=utf-8,' + encodeURIComponent(resolved);
          }
          this.values.set(key, rendered); return rendered;
        })();
        this.loading.set(key, task);
      }
      return await this.loading.get(key) + url.hash;
    }
    resolve(value, base = this.base) {
      const url = assetUrl(value, base); if (!url) return value;
      // Unresolved workspace references never reach the client's network.
      return (this.values.get(keyFor(url)) || 'data:,') + url.hash;
    }
    async prepare(doc) {
      const references = [];
      for (const node of doc.querySelectorAll('*')) {
        for (const attr of resourceAttributes(node)) references.push(node.getAttribute(attr));
        if (node.hasAttribute('srcset')) references.push(...srcsetEntries(node.getAttribute('srcset')).map(entry => entry.url));
        if (node.hasAttribute('style')) references.push(...cssReferences(node.getAttribute('style')));
        if (node.tagName.toLowerCase() === 'style') references.push(...cssReferences(node.textContent));
      }
      for (const reference of new Set(references)) await this.load(reference);
    }
  }
  function resourceAttributes(node) {
    const attrs = ['src', 'poster', 'background'];
    if (['link', 'image', 'use', 'feimage'].includes(node.tagName?.toLowerCase())) attrs.push('href', 'xlink:href');
    return attrs.filter(attr => node.hasAttribute(attr));
  }
  function nodes(root) { return [root, ...root.querySelectorAll('*')].filter(node => node.attributes); }
  function renderResources(root, resources) {
    for (const node of nodes(root)) {
      const saved = {};
      for (const attr of resourceAttributes(node)) {
        const original = node.getAttribute(attr), rendered = resources.resolve(original);
        if (original !== rendered) { saved[attr] = { original, rendered }; node.setAttribute(attr, rendered); }
      }
      if (node.hasAttribute('srcset')) {
        const original = node.getAttribute('srcset');
        const rendered = srcsetEntries(original).map(entry => resources.resolve(entry.url) + (entry.descriptor ? ' ' + entry.descriptor : '')).join(', ');
        if (original !== rendered) { saved.srcset = { original, rendered }; node.setAttribute('srcset', rendered); }
      }
      for (const attr of ['style', ...(node.tagName?.toLowerCase() === 'style' ? ['text'] : [])]) {
        const original = attr === 'text' ? node.textContent : node.getAttribute(attr);
        if (!original) continue;
        const substitutions = [];
        const rendered = rewriteCss(original, value => {
          const next = resources.resolve(value); if (next !== value) substitutions.push([next, value]); return next;
        });
        if (original !== rendered) {
          saved[attr] = { original, rendered, substitutions };
          if (attr === 'text') node.textContent = rendered; else node.setAttribute(attr, rendered);
        }
      }
      if (Object.keys(saved).length) node.setAttribute(marker, JSON.stringify(saved));
    }
    root.querySelectorAll('base').forEach(node => node.remove());
    return root;
  }
  function restoreResources(root) {
    for (const node of nodes(root)) {
      if (!node.hasAttribute(marker)) continue;
      const saved = JSON.parse(node.getAttribute(marker));
      for (const [attr, value] of Object.entries(saved)) {
        const current = attr === 'text' ? node.textContent : node.getAttribute(attr);
        let restored = current;
        if (current === value.rendered) restored = value.original;
        else if (current && value.substitutions) restored = rewriteCss(current, url => value.substitutions.find(pair => pair[0] === url)?.[1] ?? url);
        if (attr === 'text') node.textContent = restored; else if (restored !== null) node.setAttribute(attr, restored);
      }
      node.removeAttribute(marker);
    }
    return root;
  }
  const H = window.HtmlPpt;
  const originalHtml = H.DeckDocument.prototype.editorHtml, originalRestore = H.DeckDocument.prototype.restore;
  const originalResolve = H.resolveResources, originalCss = H.resourceCss;
  H.DeckDocument.prototype.editorHtml = function () {
    const html = originalHtml.call(this), resources = contexts.get(this.resourceBase);
    if (!resources) return html;
    const doc = new DOMParser().parseFromString(html, 'text/html'); renderResources(doc, resources);
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  };
  H.DeckDocument.prototype.snapshot = function (frameDoc, index) {
    return H.serializeSlide(restoreResources(frameDoc.querySelectorAll('.slide')[index].cloneNode(true)));
  };
  H.DeckDocument.prototype.restore = function (frameDoc, index, html) {
    originalRestore.call(this, frameDoc, index, html);
    const resources = contexts.get(this.resourceBase);
    if (resources) renderResources(frameDoc.querySelectorAll('.slide')[index], resources);
  };
  H.resolveResources = (root, base) => contexts.has(base) ? renderResources(root, contexts.get(base)) : originalResolve(root, base);
  H.resourceCss = (css, base) => contexts.has(base) ? rewriteCss(css, value => contexts.get(base).resolve(value)) : originalCss(css, base);
  window.paseoEmbedded = {
    updatePath: path => send('path', { path }), setModified: modified => send('modified', { modified }),
    bindEditor(editor) {
      // Paseo's close-tab guard must also cover an in-progress text edit or drag.
      for (const name of ['beginTextEdit', 'finishEdit', 'drag', 'resize', 'finishInteraction']) {
        const original = editor[name];
        editor[name] = function (...args) {
          const result = original.apply(this, args);
          send('modified', { modified: this.diskDirty() || !!this.editing || !!this.interaction?.moved });
          return result;
        };
      }
    },
    thumbnailCss(deck) {
      const resources = contexts.get(deck.resourceBase);
      return [...deck.doc.querySelectorAll('style,link[rel~="stylesheet"]')].map(node => {
        if (node.tagName.toLowerCase() === 'style') return H.resourceCss(node.textContent, deck.resourceBase);
        const url = assetUrl(node.getAttribute('href'), deck.resourceBase);
        return url && resources ? resources.styles.get(keyFor(url)) || '' : '';
      }).join('\n');
    },
  };
  class WorkspaceClient {
    constructor() { this.info = null; this.initialPath = null; }
    get connected() { return !!this.info; }
    async connect() {
      const config = await initialized; this.initialPath = config.path;
      try { this.info = await request({ method: 'info' }); return true; }
      catch (error) { send('error', { message: error.message }); throw error; }
    }
    list(path = '') { return request({ method: 'list', path }); }
    async read(path) {
      const file = await request({ method: 'read', path });
      file.base_url += '?document=' + encodeURIComponent(file.path) + '&revision=' + file.revision;
      const html = file.kind === 'project' ? JSON.parse(file.content).html : file.content;
      const resources = new Resources(file.base_url), doc = new DOMParser().parseFromString(html, 'text/html');
      H.sanitize(doc); await resources.prepare(doc); contexts.set(file.base_url, resources); return file;
    }
    save(file, content) { return request({ method: 'save', path: file.path, revision: file.revision, content }); }
    draftKey(path) { return 'workspace:' + this.info.id + ':' + path; }
  }
  H.WorkspaceClient = WorkspaceClient;
})();
