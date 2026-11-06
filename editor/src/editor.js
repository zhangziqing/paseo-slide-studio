(() => {
  'use strict';
  const H = window.HtmlPpt;
  const $ = id => document.getElementById(id);
  const paths = {
    slides: '<rect x="6" y="3" width="15" height="13" rx="2"/><path d="M3 8v11a2 2 0 0 0 2 2h13M10 7h7M10 11h4"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1M3 7h18l-2 11H4L2 9a2 2 0 0 1 1-2Z"/>',
    save: '<path d="m16 3 5 5v12H3V3h13Z"/><path d="M7 3v6h9V3M7 20v-7h10v7"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    undo: '<path d="M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12"/>',
    redo: '<path d="m15 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
    text: '<path d="M4 6V3h16v3M12 3v18m-4 0h8"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
    magnet: '<path d="M5 3v10a7 7 0 0 0 14 0V3h-5v10a2 2 0 0 1-4 0V3H5Zm0 5h5m4 0h5"/>',
    play: '<path d="m8 4 12 8-12 8V4Z"/>',
    minus: '<path d="M5 12h14"/>', plus: '<path d="M5 12h14M12 5v14"/>',
    cursor: '<path d="m5 3 15 10-7 1-4 7L5 3Z"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-4-4L5 15l-1 5Z"/>',
    'align-left': '<path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>',
    'align-center': '<path d="M4 5h16M7 10h10M4 15h16M7 20h10"/>',
    'align-right': '<path d="M4 5h16M10 10h10M4 15h16M10 20h10"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    layers: '<path d="m12 3 10 6-10 6L2 9l10-6Zm-9 11 9 5 9-5M3 18l9 5 9-5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    'chevron-left': '<path d="m15 5-7 7 7 7"/>',
    'chevron-right': '<path d="m9 5 7 7-7 7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M10 4v16"/>'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('icon');
    svg.innerHTML = paths[name] || paths.text;
    return svg;
  }
  function fillIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => el.replaceChildren(icon(el.dataset.icon)));
  }
  fillIcons();
  const labelFor = el => H.imageKind(el) ? (el.getAttribute('aria-label') || el.querySelector('svg')?.getAttribute('aria-label') || el.querySelector('img')?.alt || '图片 / 图示') : H.cleanText(el) || '空白文字';
  const typeLabel = el => ({image: '图片 / 图示', table: '表格', text: '文字'})[H.kind(el)];
  function rgbHex(color) {
    if (/^#[\da-f]{6}$/i.test(color)) return color;
    const n = color.match(/[\d.]+/g);
    return n?.length >= 3 ? '#' + n.slice(0, 3).map(x => Math.min(255, Math.round(Number(x))).toString(16).padStart(2, '0')).join('') : '#000000';
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], {type}));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  class Editor {
    constructor() {
      this.deck = null; this.page = 0; this.selectedId = null; this.scale = 1; this.zoom = null;
      this.frame = $('deck-frame'); this.frameDoc = null; this.history = new H.History();
      this.store = new H.DraftStore(); this.snap = false; this.presenting = false;
      this.workspace = new H.WorkspaceClient(); this.serverFile = null; this.diskSavedRevision = 0;
      this.serverDirectory = ''; this.savingToServer = false; this.draftState = null;
      this.editing = null; this.interaction = null; this.revision = 0; this.savedRevision = 0;
      this.loadToken = 0; this.saveChain = Promise.resolve(); this.pendingSave = false;
      this.bindUI();
      new ResizeObserver(() => this.fit()).observe($('viewport'));
      addEventListener('keydown', e => this.keydown(e));
      addEventListener('beforeunload', e => {
        if (this.editing || this.interaction || this.pendingSave || this.diskDirty()) { e.preventDefault(); e.returnValue = ''; }
      });
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && this.presenting && this.usedFullscreen) this.exitPresent();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && this.deck) { this.finishEdit(); this.finishInteraction(); this.saveDraft(); }
      });
    }
    bindUI() {
      for (const id of ['open-file', 'empty-open']) $(id).onclick = () => this.workspace.connected ? this.browseWorkspace() : $('file-input').click();
      $('open-example').onclick = () => this.openExample();
      $('close-files').onclick = () => $('files-dialog').close();
      $('refresh-files').onclick = () => this.browseWorkspace(this.serverDirectory);
      $('files-up').onclick = () => this.browseWorkspace(this.serverDirectory.split('/').slice(0, -1).join('/'));
      $('files-filter').oninput = () => this.renderServerFiles();
      $('open-local').onclick = () => $('file-input').click();
      $('download-project').onclick = () => this.downloadProject();
      $('restore-workspace-draft').onclick = () => this.restoreWorkspaceDraft().catch(err => this.toast(err.message));
      $('dismiss-workspace-draft').onclick = () => { $('workspace-draft').hidden = true; this.recoverableDraft = null; };
      $('file-input').onchange = async e => {
        const file = e.target.files[0]; e.target.value = ''; if (!file) return;
        try {
          if (!this.canSwitchFile()) return;
          const content = await file.text();
          if (/\.json$/i.test(file.name)) await this.load(H.DeckDocument.fromProject(JSON.parse(content)));
          else await this.open(content, file.name);
          this.queueSave();
          $('files-dialog').close();
          this.toast('已打开 ' + file.name);
        } catch (err) { this.toast('打开失败：' + err.message); }
      };
      $('image-input').onchange = async e => {
        const file = e.target.files[0]; e.target.value = ''; if (!file) return;
        const mode = this.imageMode; this.imageMode = null;
        try { await this.insertImage(file, mode); } catch (err) { this.toast('图片未插入：' + err.message); }
      };
      $('save-project').onclick = () => this.saveProject();
      $('export-html').onclick = () => this.exportHtml();
      $('undo').onclick = () => this.undo(); $('redo').onclick = () => this.redo();
      $('add-text').onclick = () => this.addText();
      $('add-image').onclick = () => { this.imageMode = null; $('image-input').click(); };
      $('replace-image').onclick = () => { this.imageMode = this.selectedId; $('image-input').click(); };
      $('snap').onclick = () => { this.snap = !this.snap; $('snap').setAttribute('aria-pressed', String(this.snap)); };
      $('zoom-fit').onclick = () => { this.zoom = null; this.fit(); };
      $('zoom-out').onclick = () => { this.zoom = Math.max(.1, this.scale - .1); this.fit(); };
      $('zoom-in').onclick = () => { this.zoom = Math.min(2, this.scale + .1); this.fit(); };
      $('edit-text').onclick = () => this.beginTextEdit(this.selected());
      $('duplicate-object').onclick = () => this.duplicate();
      $('delete-object').onclick = () => this.delete();
      $('bring-front').onclick = () => this.mutate('置顶对象', el => {
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        el.style.zIndex = String(Math.max(0, ...this.objects().map(n => H.number(n.style.zIndex))) + 1);
      });
      for (const key of ['x', 'y', 'width', 'height']) $('prop-' + key).onchange = () => this.changeGeometry(key);
      $('prop-font-size').onchange = () => this.changeFontSize();
      $('prop-line-height').onchange = () => {
        const value = H.number($('prop-line-height').value, 0);
        if (value < 6 || value > 300) { this.updateInspector(); return; }
        this.mutate('调整行高', el => el.style.setProperty('line-height', value + 'px', 'important'));
      };
      $('prop-font').onchange = () => {
        const fonts = {original: 'DeckLatin, DeckCJK, sans-serif', sans: 'Arial, "Microsoft YaHei", sans-serif', serif: 'Georgia, "Songti SC", serif', mono: 'DeckMono, Consolas, monospace'};
        this.mutate('更换字体', el => {
          el.style.setProperty('font-family', fonts[$('prop-font').value], 'important');
          el.querySelectorAll('[style*="font-family"]').forEach(n => n.style.removeProperty('font-family'));
        });
      };
      $('bold').onclick = () => this.mutate('调整粗体', el => {
        const value = getComputedStyle(el).fontWeight >= 600 ? '400' : '700';
        el.style.setProperty('font-weight', value, 'important');
        el.querySelectorAll('strong,b,[style*="font-weight"]').forEach(n => n.style.setProperty('font-weight', value, 'important'));
      });
      $('italic').onclick = () => this.mutate('调整斜体', el => {
        el.style.setProperty('font-style', getComputedStyle(el).fontStyle === 'italic' ? 'normal' : 'italic', 'important');
        // The original deck embeds regular/bold faces. Permit italic synthesis
        // only after an explicit italic action; bold synthesis remains disabled.
        el.style.setProperty('font-synthesis', 'style', 'important');
      });
      document.querySelectorAll('[data-align]').forEach(button => button.onclick = () => this.mutate('调整对齐', el => el.style.setProperty('text-align', button.dataset.align, 'important')));
      $('prop-color').onchange = () => this.mutate('调整文字颜色', el => {
        el.style.setProperty('color', $('prop-color').value, 'important');
        el.querySelectorAll('[style*="color"]').forEach(n => n.style.setProperty('color', $('prop-color').value, 'important'));
      });
      $('selection').querySelectorAll('[data-handle]').forEach(handle => handle.onpointerdown = e => this.startResize(e, handle));
      $('audit').onclick = () => { this.finishEdit(); this.showAudit(); };
      $('close-audit').onclick = () => $('audit-dialog').close();
      $('present').onclick = () => this.enterPresent();
      $('present-prev').onclick = () => this.showPage(this.page - 1);
      $('present-next').onclick = () => this.showPage(this.page + 1);
      $('present-exit').onclick = () => this.exitPresent();
      $('viewport').onpointerdown = e => {
        if (e.target === $('viewport')) { this.finishEdit(); this.select(null); }
      };
      document.querySelector('.brand').onclick = e => { e.preventDefault(); this.zoom = null; this.fit(); };
    }
    toast(message) {
      clearTimeout(this.toastTimer); $('toast').textContent = message; $('toast').hidden = false;
      this.toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
    }
    diskDirty() { return !!this.serverFile && this.revision !== this.diskSavedRevision; }
    canSwitchFile() {
      this.finishEdit(); this.finishInteraction();
      if (this.savingToServer) { this.toast('正在保存服务器文件，请稍候'); return false; }
      return !this.diskDirty() || confirm('当前文件有尚未写回服务器的修改。切换文件会放弃当前编辑；是否继续？');
    }
    async browseWorkspace(path = this.serverDirectory) {
      if (!$('files-dialog').open) $('files-dialog').showModal();
      $('files-error').hidden = true;
      const request = this.browserRequest = (this.browserRequest || 0) + 1;
      $('server-file-list').textContent = '正在读取服务器目录…';
      try {
        const listing = await this.workspace.list(path);
        if (request !== this.browserRequest) return;
        this.serverDirectory = listing.path; this.serverEntries = listing.entries;
        $('files-path').textContent = this.workspace.info.name + ' / ' + listing.path;
        $('files-path').title = $('files-path').textContent;
        $('files-up').disabled = !listing.path; $('files-filter').value = '';
        this.renderServerFiles();
      } catch (err) {
        if (request !== this.browserRequest) return;
        $('server-file-list').replaceChildren(); $('files-error').hidden = false;
        $('files-error').textContent = err.message;
      }
    }
    renderServerFiles() {
      const list = $('server-file-list'); list.replaceChildren();
      const query = $('files-filter').value.toLocaleLowerCase();
      const entries = (this.serverEntries || []).filter(entry => entry.name.toLocaleLowerCase().includes(query));
      for (const entry of entries) {
        const button = document.createElement('button'); button.className = 'server-file'; button.dataset.path = entry.path;
        button.setAttribute('aria-label', entry.kind === 'directory' ? '打开目录 ' + entry.name : '打开文件 ' + entry.name);
        const name = document.createElement('span'); name.textContent = entry.name;
        const detail = document.createElement('small');
        detail.textContent = entry.kind === 'directory' ? '目录' : entry.kind === 'project' ? '项目文件' : Math.max(1, Math.round(entry.size / 1024)) + ' KB · HTML';
        button.append(icon(entry.kind === 'directory' ? 'folder' : 'slides'), name, detail);
        button.onclick = async () => {
          if (entry.kind === 'directory') { await this.browseWorkspace(entry.path); return; }
          button.disabled = true;
          try { await this.openServerFile(entry.path); } catch (err) { $('files-error').textContent = err.message; $('files-error').hidden = false; }
          finally { button.disabled = false; }
        };
        list.append(button);
      }
      if (!entries.length) {
        const note = document.createElement('p'); note.className = 'server-files-empty';
        note.textContent = query ? '没有匹配的文件。' : '此目录没有可编辑的 HTML PPT 或项目文件。'; list.append(note);
      }
    }
    async openServerFile(path) {
      if (!this.canSwitchFile()) return;
      const request = this.fileRequest = (this.fileRequest || 0) + 1;
      const file = await this.workspace.read(path);
      if (request !== this.fileRequest) return;
      const deck = file.kind === 'project' ? H.DeckDocument.fromProject(JSON.parse(file.content)) : new H.DeckDocument(file.content, file.path.split('/').pop());
      deck.resourceBase = new URL(file.base_url, location.href).href;
      await this.load(deck, {path: file.path, kind: file.kind, revision: file.revision, baseUrl: deck.resourceBase});
      if (request !== this.fileRequest) return;
      this.serverDirectory = file.path.split('/').slice(0, -1).join('/');
      $('files-dialog').close();
      const token = this.loadToken;
      try {
        const draft = await this.store.read(this.workspace.draftKey(file.path));
        if (token === this.loadToken && draft?.workspace?.dirty && draft.workspace.path === file.path) {
          this.recoverableDraft = draft; $('workspace-draft').hidden = false;
        }
      } catch { /* Server saving is available even when browser drafts are disabled. */ }
    }
    async restoreWorkspaceDraft() {
      if (!this.serverFile || !this.recoverableDraft || !this.canSwitchFile()) return;
      const draft = this.recoverableDraft;
      const file = {...this.serverFile, revision: draft.workspace.revision};
      const deck = H.DeckDocument.fromProject(draft); deck.resourceBase = file.baseUrl;
      await this.load(deck, file); this.revision = 1; this.queueSave();
      this.toast('已恢复浏览器草稿；点击“保存到服务器”写回文件');
    }
    updateSaveStatus() {
      const dirty = this.diskDirty();
      $('save-status').classList.toggle('unsaved', dirty);
      if (this.serverFile) {
        $('save-status').textContent = this.savingToServer ? '正在写回服务器…' : this.lastServerError ?
          (this.lastServerError === 409 ? '保存冲突 · 文件已被其他程序修改' : '服务器保存失败 · 修改仍保留在编辑器') : dirty ?
          (this.draftState === 'saved' ? '浏览器草稿已保存 · 尚未写回服务器' : this.draftState === 'failed' ? '尚未保存 · 请点击保存到服务器' : '有修改 · Ctrl / ⌘ S 写回服务器') : '服务器文件已保存';
      } else {
        $('save-status').textContent = this.draftState === 'saving' ? '正在保存浏览器草稿…' : this.draftState === 'saved' ? '草稿已保存到此浏览器' : this.draftState === 'failed' ? '浏览器草稿未保存 · 请保存项目文件' : '本地编辑 · 更改后自动保存草稿';
      }
    }
    async start() {
      if (await this.workspace.connect()) {
        document.querySelector('.version').textContent = 'SERVER';
        $('open-file').replaceChildren(icon('folder'), document.createTextNode('服务器文件'));
        $('empty-open').replaceChildren(icon('folder'), document.createTextNode('浏览服务器文件'));
        $('open-example').replaceChildren(icon('folder'), document.createTextNode('浏览服务器文件'));
        $('save-status').textContent = `已连接 ${this.workspace.info.name} 目录`;
        const path = new URL(location.href).searchParams.get('file');
        if (path) {
          try { await this.openServerFile(path); } catch (err) { this.toast('打开失败：' + err.message); await this.browseWorkspace(''); }
        } else await this.browseWorkspace('');
        return;
      }
      try {
        const draft = await this.store.read();
        if (draft) { await this.load(H.DeckDocument.fromProject(draft)); $('save-status').textContent = '已恢复此浏览器中的草稿'; this.toast('已恢复此浏览器中上次编辑的草稿'); return; }
      } catch { /* File mode/private mode may not provide durable storage. */ }
      await this.openExample(false);
    }
    async openExample(notify = true) {
      if (this.workspace.connected) { await this.browseWorkspace(); return; }
      const example = JSON.parse($('starter-deck').textContent);
      if (!example) { if (notify) this.toast('源码入口未内嵌示例；请打开 presentation.html，或运行 build.py'); return; }
      await this.open(example.html, example.filename);
      if (notify) { this.queueSave(); this.toast('已打开当前 PPT 的独立编辑副本'); }
    }
    async open(html, filename) { await this.load(new H.DeckDocument(html, filename)); }
    async load(deck, serverFile = null) {
      this.finishEdit(); this.finishInteraction();
      if (this.deck && this.pendingSave) await this.saveDraft();
      clearTimeout(this.saveTimer); clearTimeout(this.auditTimer);
      const token = ++this.loadToken;
      this.deck = deck; this.history = new H.History(); this.page = 0; this.selectedId = null; this.zoom = null;
      this.revision = 0; this.savedRevision = 0; this.pendingSave = false;
      this.serverFile = serverFile; this.diskSavedRevision = 0; this.draftState = null; this.lastServerError = null;
      this.recoverableDraft = null; $('workspace-draft').hidden = true;
      $('document-path').hidden = !serverFile;
      $('document-path').textContent = serverFile ? this.workspace.info.name + ' / ' + serverFile.path : '';
      $('document-path').title = $('document-path').textContent;
      $('save-button-label').textContent = serverFile ? '保存到服务器' : '保存项目';
      $('download-project').hidden = !serverFile;
      if (this.workspace.connected) {
        const url = new URL(location.href);
        if (serverFile) url.searchParams.set('file', serverFile.path); else url.searchParams.delete('file');
        history.replaceState(null, '', url);
      }
      $('document-title').textContent = deck.title;
      $('save-status').textContent = '正在打开…';
      this.frameDoc = null; $('selection').hidden = true;
      $('empty-state').hidden = true; $('canvas-holder').hidden = false;
      $('canvas').style.width = deck.width + 'px'; $('canvas').style.height = deck.height + 'px';
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('画布加载超时')), 15000);
        this.frame.onload = () => { clearTimeout(timer); resolve(); };
        this.frame.srcdoc = deck.editorHtml();
      });
      if (token !== this.loadToken) return;
      this.frameDoc = this.frame.contentDocument;
      this.frameDoc.addEventListener('pointerdown', e => this.startDrag(e));
      this.frameDoc.addEventListener('pointermove', e => this.drag(e));
      this.frameDoc.addEventListener('pointerup', () => this.finishInteraction());
      this.frameDoc.addEventListener('pointercancel', () => this.finishInteraction(true));
      this.frameDoc.addEventListener('dblclick', e => {
        if (this.presenting || this.editing) return;
        const el = e.target.closest('[data-ppt-id]');
        if (el && H.kind(el) === 'text') { e.preventDefault(); this.beginTextEdit(el); }
      });
      this.frameDoc.addEventListener('click', e => { if (e.target.closest('a,button,form')) e.preventDefault(); });
      this.frameDoc.addEventListener('keydown', e => this.keydown(e));
      this.frameDoc.addEventListener('dragstart', e => e.preventDefault());
      await this.frameDoc.fonts.ready;
      this.installThumbnailStyle(); this.renderSlides(); this.showPage(0);
      this.fit(); this.updateHistory(); this.refreshAudit();
      $('canvas-dimensions').textContent = `${deck.width} × ${deck.height}`;
      this.updateSaveStatus();
      for (const id of ['save-project', 'export-html', 'add-text', 'add-image', 'audit', 'present']) $(id).disabled = false;
    }
    installThumbnailStyle() {
      const css = H.resourceCss([...this.deck.doc.querySelectorAll('style')].map(n => n.textContent).join('\n'), this.deck.resourceBase);
      this.thumbStyle = css + `\n:host{display:block;position:relative;width:100%;height:100%;overflow:hidden;pointer-events:none}.slide{display:block!important;position:absolute!important;left:0!important;top:0!important;margin:0!important;transform:scale(var(--thumb-scale))!important;transform-origin:top left!important;font-family:DeckLatin,DeckCJK,sans-serif}.toolbar,.qa-banner{display:none!important}`;
      $('ppt-thumbnail-fonts')?.remove();
      const style = document.createElement('style'); style.id = 'ppt-thumbnail-fonts';
      style.textContent = (css.match(/@font-face\s*\{[^}]+\}/g) || []).join('\n');
      document.head.append(style);
      this.thumbSheet = null;
      try { this.thumbSheet = new CSSStyleSheet(); this.thumbSheet.replaceSync(this.thumbStyle); } catch { /* A style element works in older browsers. */ }
    }
    renderSlides() {
      $('slide-list').replaceChildren();
      $('slide-count').textContent = this.deck.slides.length;
      this.deck.slides.forEach((_, index) => {
        const button = document.createElement('button'); button.className = 'slide-card'; button.dataset.page = index;
        button.setAttribute('aria-label', `第 ${index + 1} 页：${this.deck.label(index)}`);
        const preview = document.createElement('span'); preview.className = 'thumb-preview'; preview.setAttribute('aria-hidden', 'true');
        preview.style.aspectRatio = this.deck.width + '/' + this.deck.height;
        preview.attachShadow({mode: 'open'});
        const label = document.createElement('span'); label.className = 'thumb-label';
        const num = document.createElement('span'); num.className = 'thumb-number'; num.textContent = String(index + 1).padStart(2, '0');
        const title = document.createElement('span'); title.className = 'thumb-title'; title.textContent = this.deck.label(index);
        label.append(num, title); button.append(preview, label); button.onclick = () => this.showPage(index);
        $('slide-list').append(button); this.renderThumbnail(index);
      });
    }
    renderThumbnail(index) {
      const button = $('slide-list').querySelector(`[data-page="${index}"]`); if (!button) return;
      const preview = button.querySelector('.thumb-preview'); const root = preview.shadowRoot;
      root.replaceChildren();
      if (this.thumbSheet) root.adoptedStyleSheets = [this.thumbSheet];
      else { const style = document.createElement('style'); style.textContent = this.thumbStyle; root.append(style); }
      const clone = H.resolveResources(H.sanitize(H.clearEditing(this.deck.slides[index].cloneNode(true))), this.deck.resourceBase);
      clone.removeAttribute('inert'); clone.removeAttribute('aria-hidden'); root.append(clone);
      preview.style.setProperty('--thumb-scale', (preview.clientWidth || 166) / this.deck.width);
      button.querySelector('.thumb-title').textContent = this.deck.label(index);
      button.setAttribute('aria-label', `第 ${index + 1} 页：${this.deck.label(index)}`);
    }
    currentSlide() { return this.frameDoc?.querySelectorAll('.slide')[this.page]; }
    objects() { return this.currentSlide() ? [...this.currentSlide().querySelectorAll('[data-ppt-id]')] : []; }
    selected() { return this.objects().find(n => n.dataset.pptId === this.selectedId) || null; }
    showPage(page) {
      if (!this.deck || !this.frameDoc) return;
      this.finishEdit(); this.finishInteraction();
      this.page = Math.max(0, Math.min(this.deck.slides.length - 1, page)); this.selectedId = null;
      this.frameDoc.querySelectorAll('.slide').forEach((slide, i) => {
        slide.toggleAttribute('data-ppt-active', i === this.page); slide.inert = i !== this.page;
        slide.setAttribute('aria-hidden', String(i !== this.page));
      });
      $('slide-list').querySelectorAll('.slide-card').forEach((button, i) => button.setAttribute('aria-current', String(i === this.page)));
      const active = $('slide-list').querySelector(`[data-page="${this.page}"]`);
      active?.scrollIntoView({block: 'nearest'});
      $('page-label').textContent = `${String(this.page + 1).padStart(2, '0')} / ${String(this.deck.slides.length).padStart(2, '0')}  ·  ${this.deck.label(this.page).slice(0, 26)}`;
      $('present-position').textContent = `${this.page + 1} / ${this.deck.slides.length}`;
      $('present-prev').disabled = this.page === 0; $('present-next').disabled = this.page === this.deck.slides.length - 1;
      this.renderObjects(); this.updateInspector(); this.updateSelection();
    }
    select(id) {
      if (this.editing && id !== this.selectedId) this.finishEdit();
      const changed = id !== this.selectedId; this.selectedId = id;
      if (changed && this.selected()) $('lock-ratio').checked = H.imageKind(this.selected());
      this.updateSelection(); this.updateInspector();
      $('object-list').querySelectorAll('.layer-item').forEach(b => b.setAttribute('aria-current', String(b.dataset.id === id)));
    }
    rect(el) {
      const r = el.getBoundingClientRect(), s = this.currentSlide().getBoundingClientRect();
      return {x: r.left - s.left, y: r.top - s.top, width: r.width, height: r.height};
    }
    updateSelection() {
      const el = this.selected(), box = $('selection');
      if (!el || this.presenting) { box.hidden = true; return; }
      const r = this.rect(el); box.hidden = false;
      Object.assign(box.style, {left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px'});
      $('selection-label').textContent = this.editing ? '正在编辑 · Esc 完成' : typeLabel(el);
      $('selection-size').textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    }
    fit() {
      if (!this.deck) return;
      const viewport = $('viewport');
      const availableW = Math.max(100, viewport.clientWidth - (this.presenting ? 0 : 68));
      const availableH = Math.max(100, viewport.clientHeight - (this.presenting ? 0 : 75));
      this.scale = this.presenting ? Math.min(availableW / this.deck.width, availableH / this.deck.height) : this.zoom || Math.min(availableW / this.deck.width, availableH / this.deck.height, 1.25);
      this.scale = Math.max(.1, this.scale);
      $('canvas-holder').style.width = this.deck.width * this.scale + 'px';
      $('canvas-holder').style.height = this.deck.height * this.scale + 'px';
      $('canvas').style.transform = `scale(${this.scale})`;
      $('canvas').style.setProperty('--canvas-scale', this.scale);
      $('zoom-fit').textContent = `${Math.round(this.scale * 100)}%`;
      // Keep the top/left reachable when the user zooms beyond the available space.
      viewport.style.justifyContent = this.deck.width * this.scale > availableW ? 'flex-start' : 'center';
      viewport.style.alignItems = this.deck.height * this.scale > availableH ? 'flex-start' : 'center';
      document.querySelectorAll('.thumb-preview').forEach(n => n.style.setProperty('--thumb-scale', n.clientWidth / this.deck.width));
      this.updateSelection();
    }
    renderObjects() {
      const list = $('object-list'); list.replaceChildren();
      $('object-count').textContent = this.objects().length;
      this.objects().forEach(el => {
        const b = document.createElement('button'); b.className = 'layer-item'; b.dataset.id = el.dataset.pptId;
        const text = document.createElement('span'); text.textContent = labelFor(el); b.title = text.textContent;
        b.append(icon(H.kind(el) === 'text' ? 'text' : H.kind(el) === 'table' ? 'table' : 'image'), text);
        b.setAttribute('aria-current', String(this.selectedId === el.dataset.pptId));
        b.onclick = () => this.select(el.dataset.pptId); list.append(b);
      });
    }
    updateInspector() {
      const el = this.selected();
      $('inspector-empty').hidden = !!el; $('object-properties').hidden = !el;
      $('object-type').textContent = el ? typeLabel(el) : '未选择';
      if (!el) return;
      const r = this.rect(el), css = getComputedStyle(el), text = H.kind(el) === 'text';
      for (const key of ['x', 'y', 'width', 'height']) $('prop-' + key).value = Math.round(r[key] * 10) / 10;
      $('text-properties').hidden = !text; $('image-properties').hidden = !H.imageKind(el);
      if (text) {
        $('prop-font-size').value = Math.round(H.number(css.fontSize));
        $('prop-line-height').value = Math.round(H.number(css.lineHeight, H.number(css.fontSize) * 1.2));
        $('bold').setAttribute('aria-pressed', String(css.fontWeight >= 600));
        $('italic').setAttribute('aria-pressed', String(css.fontStyle === 'italic'));
        document.querySelectorAll('[data-align]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.align === css.textAlign)));
        $('prop-color').value = rgbHex(css.color); $('color-value').textContent = rgbHex(css.color).toUpperCase();
        $('prop-font').value = /Consolas|DeckMono/.test(css.fontFamily) ? 'mono' : /Georgia|Songti/.test(css.fontFamily) ? 'serif' : /DeckLatin/.test(css.fontFamily) ? 'original' : 'sans';
      }
    }
    snapshot() { return this.deck.snapshot(this.frameDoc, this.page); }
    commit(before, label, id = this.selectedId, beforeSelection = id) {
      const title = this.currentSlide().querySelector('[data-role="title"]');
      if (title) this.currentSlide().setAttribute('aria-label', H.cleanText(title));
      const after = this.snapshot();
      if (!this.history.push({before, after, label, page: this.page, selectedId: id, beforeSelection})) return;
      this.deck.update(this.page, after); this.revision++;
      this.renderThumbnail(this.page); this.renderObjects(); this.updateInspector(); this.updateSelection(); this.updateHistory();
      this.queueSave(); clearTimeout(this.auditTimer); this.auditTimer = setTimeout(() => this.refreshAudit(), 500);
    }
    mutate(label, action) {
      this.finishEdit(); this.finishInteraction();
      const el = this.selected(); if (!el) return;
      const before = this.snapshot(), beforeSelection = this.selectedId;
      action(el); this.commit(before, label, this.selectedId, beforeSelection);
    }
    updateHistory() {
      $('undo').disabled = !this.history.canUndo; $('redo').disabled = !this.history.canRedo;
      $('undo').title = this.history.canUndo ? '撤销：' + this.history.entries[this.history.cursor - 1].label : '撤销';
      $('redo').title = this.history.canRedo ? '重做：' + this.history.entries[this.history.cursor].label : '重做';
    }
    undo() {
      this.finishEdit(); this.finishInteraction(); const entry = this.history.undo(); if (!entry) return;
      this.deck.restore(this.frameDoc, entry.page, entry.before); this.showPage(entry.page); this.select(entry.beforeSelection); this.afterHistory(entry.page);
    }
    redo() {
      this.finishEdit(); this.finishInteraction(); const entry = this.history.redo(); if (!entry) return;
      this.deck.restore(this.frameDoc, entry.page, entry.after); this.showPage(entry.page); this.select(entry.selectedId); this.afterHistory(entry.page);
    }
    afterHistory(page) { this.revision++; this.renderThumbnail(page); this.updateHistory(); this.queueSave(); this.refreshAudit(); }
    setPosition(el, x, y) {
      const r = this.rect(el), old = H.offset(el);
      el.style.translate = `${old.x + x - r.x}px ${old.y + y - r.y}px`;
    }
    setSize(el, width, height, initial = null) {
      const r = initial?.rect || this.rect(el), scale = initial?.scale || H.scaling(el);
      if (H.imageKind(el)) {
        el.style.transformOrigin = 'top left';
        el.style.scale = `${scale.x * width / r.width} ${scale.y * height / r.height}`;
      } else {
        el.style.setProperty('width', width / scale.x + 'px', 'important');
        el.style.setProperty('height', height / scale.y + 'px', 'important');
      }
    }
    changeGeometry(key) {
      const value = Number($('prop-' + key).value);
      if (!Number.isFinite(value) || (['width', 'height'].includes(key) && (value < 12 || value > 8000))) { this.updateInspector(); return; }
      this.mutate('调整位置与大小', el => {
        const r = this.rect(el);
        if (key === 'x' || key === 'y') this.setPosition(el, key === 'x' ? value : r.x, key === 'y' ? value : r.y);
        else {
          const ratio = r.width / r.height, lock = $('lock-ratio').checked;
          this.setSize(el, key === 'width' ? value : lock ? value * ratio : r.width, key === 'height' ? value : lock ? value / ratio : r.height);
        }
      });
    }
    changeFontSize() {
      const size = Number($('prop-font-size').value);
      if (!Number.isFinite(size) || size < 6 || size > 200) { this.updateInspector(); return; }
      this.mutate('调整字号', el => {
        const css = getComputedStyle(el), before = H.number(css.fontSize, 28), line = H.number(css.lineHeight, before * 1.25);
        el.style.setProperty('font-size', size + 'px', 'important');
        el.style.setProperty('line-height', size * line / before + 'px', 'important');
      });
    }
    startDrag(e) {
      if (e.button !== 0 || this.presenting || !this.deck) return;
      if (e.target.closest('[data-ppt-text-editor]')) return;
      this.finishEdit();
      const el = e.target.closest('[data-ppt-id]');
      if (!el || !this.currentSlide().contains(el)) { this.select(null); return; }
      e.preventDefault(); this.select(el.dataset.pptId);
      this.interaction = {kind: 'move', el, before: this.snapshot(), startX: e.clientX, startY: e.clientY,
        offset: H.offset(el), rect: this.rect(el), moved: false};
      try { el.setPointerCapture(e.pointerId); } catch { /* Synthetic events have no capture. */ }
    }
    drag(e) {
      const action = this.interaction; if (!action || action.kind !== 'move') return;
      let dx = e.clientX - action.startX, dy = e.clientY - action.startY;
      if (!action.moved && Math.hypot(dx, dy) < 3) return;
      action.moved = true;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (this.snap) {
        dx = Math.round(dx / 4) * 4; dy = Math.round(dy / 4) * 4;
        const cx = action.rect.x + action.rect.width / 2 + dx, cy = action.rect.y + action.rect.height / 2 + dy;
        const nearX = Math.abs(cx - this.deck.width / 2) < 6, nearY = Math.abs(cy - this.deck.height / 2) < 6;
        if (nearX) dx += this.deck.width / 2 - cx;
        if (nearY) dy += this.deck.height / 2 - cy;
        $('guide-x').hidden = !nearX; $('guide-y').hidden = !nearY;
      }
      action.el.style.translate = `${action.offset.x + dx}px ${action.offset.y + dy}px`;
      this.updateSelection(); this.updateInspector();
    }
    startResize(e, handle) {
      if (!this.selected() || this.presenting) return;
      this.finishEdit(); this.finishInteraction(); e.preventDefault(); e.stopPropagation();
      const el = this.selected();
      this.interaction = {kind: 'resize', el, before: this.snapshot(), startX: e.clientX, startY: e.clientY,
        rect: this.rect(el), scale: H.scaling(el), handle: handle.dataset.handle, moved: false};
      handle.setPointerCapture(e.pointerId);
      handle.onpointermove = event => this.resize(event);
      handle.onpointerup = () => this.finishInteraction();
      handle.onpointercancel = () => this.finishInteraction(true);
    }
    resize(e) {
      const a = this.interaction; if (!a || a.kind !== 'resize') return;
      const dx = (e.clientX - a.startX) / this.scale, dy = (e.clientY - a.startY) / this.scale;
      if (!a.moved && Math.hypot(dx, dy) < 2) return;
      a.moved = true;
      const west = a.handle.includes('w'), north = a.handle.includes('n');
      let width = Math.max(12, a.rect.width + (west ? -dx : dx)), height = Math.max(12, a.rect.height + (north ? -dy : dy));
      if ($('lock-ratio').checked || e.shiftKey) {
        const factor = Math.abs(dx / a.rect.width) >= Math.abs(dy / a.rect.height) ? width / a.rect.width : height / a.rect.height;
        width = a.rect.width * factor; height = a.rect.height * factor;
      }
      this.setSize(a.el, width, height, a);
      this.setPosition(a.el, a.rect.x + (west ? a.rect.width - width : 0), a.rect.y + (north ? a.rect.height - height : 0));
      this.updateSelection(); this.updateInspector();
    }
    finishInteraction(cancel = false) {
      const a = this.interaction; if (!a) return;
      this.interaction = null; $('guide-x').hidden = true; $('guide-y').hidden = true;
      if (cancel && a.moved) {
        this.deck.restore(this.frameDoc, this.page, a.before); this.showPage(this.page); this.select(a.el.dataset.pptId);
      } else if (a.moved) this.commit(a.before, a.kind === 'move' ? '移动对象' : '缩放对象');
    }
    beginTextEdit(el) {
      if (!el || H.kind(el) !== 'text' || this.presenting || this.editing) return;
      this.finishInteraction(); this.select(el.dataset.pptId);
      const before = this.snapshot(), wrapper = this.frameDoc.createElement('span');
      wrapper.dataset.pptTextEditor = ''; wrapper.contentEditable = 'true'; wrapper.spellcheck = false;
      const content = [...el.childNodes].filter(n => !(n.nodeType === 1 && n.matches('.marker,.number-star')));
      wrapper.append(...content); el.append(wrapper);
      this.editing = {el, wrapper, before}; document.body.classList.add('editing-text');
      wrapper.addEventListener('paste', e => { e.preventDefault(); this.insertText(e.clipboardData.getData('text/plain')); });
      wrapper.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.insertText('\n'); }
      });
      wrapper.addEventListener('input', () => this.updateSelection());
      wrapper.addEventListener('blur', () => queueMicrotask(() => { if (this.editing?.wrapper === wrapper && this.frameDoc.activeElement !== wrapper) this.finishEdit(); }));
      wrapper.focus();
      const range = this.frameDoc.createRange(); range.selectNodeContents(wrapper); range.collapse(false);
      const selection = this.frame.contentWindow.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      $('interaction-hint').textContent = '正在编辑文字 · 点击空白或按 Esc 完成 · 支持中文输入';
      this.updateSelection();
    }
    insertText(text) {
      if (!this.editing) return;
      const selection = this.frame.contentWindow.getSelection();
      if (!selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!this.editing.wrapper.contains(range.commonAncestorContainer)) return;
      range.deleteContents();
      const fragment = this.frameDoc.createDocumentFragment();
      text.replace(/\r\n?/g, '\n').split('\n').forEach((part, i) => {
        if (i) fragment.append(this.frameDoc.createElement('br'));
        fragment.append(this.frameDoc.createTextNode(part));
      });
      const last = fragment.lastChild; range.insertNode(fragment);
      if (last) { range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
      this.updateSelection();
    }
    finishEdit() {
      const a = this.editing; if (!a) return;
      this.editing = null;
      a.wrapper.replaceWith(...a.wrapper.childNodes);
      document.body.classList.remove('editing-text');
      $('interaction-hint').textContent = '单击选择 · 双击编辑文字 · 拖动移动';
      this.commit(a.before, '编辑文字', a.el.dataset.pptId);
      this.updateSelection();
    }
    addText() {
      if (!this.deck) return;
      this.finishEdit(); this.finishInteraction(); const before = this.snapshot();
      const el = this.frameDoc.createElement('div'); el.className = 'ppt-object'; el.dataset.pptId = H.uid();
      el.setAttribute('role', 'paragraph'); el.textContent = '双击输入文字';
      Object.assign(el.style, {position: 'absolute', left: this.deck.width * .25 + 'px', top: this.deck.height * .4 + 'px',
        width: this.deck.width * .5 + 'px', minHeight: '35px', fontFamily: 'DeckLatin, DeckCJK, sans-serif', fontSize: '28px', lineHeight: '35px', color: '#000000', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', zIndex: '10'});
      this.currentSlide().append(el); this.select(el.dataset.pptId); this.commit(before, '添加文字');
      this.beginTextEdit(el);
    }
    async insertImage(file, replaceId) {
      if (!this.deck) return;
      if (file.size > 20_000_000) throw new Error('图片超过 20 MB');
      if (!/^(image\/(png|jpeg|webp|gif|svg\+xml))$/.test(file.type)) throw new Error('请使用 PNG、JPEG、WebP、GIF 或 SVG');
      const token = this.loadToken, page = this.page;
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
      });
      const probe = new Image(); probe.src = data; await probe.decode();
      if (token !== this.loadToken || page !== this.page) throw new Error('页面已切换，请在目标页重新插入');
      this.finishEdit(); this.finishInteraction(); const before = this.snapshot();
      let el = replaceId ? this.objects().find(n => n.dataset.pptId === replaceId) : null;
      if (replaceId && !el) throw new Error('原图片已被移除');
      const img = this.frameDoc.createElement('img'); img.src = data; img.alt = file.name;
      Object.assign(img.style, {width: '100%', height: '100%', objectFit: 'contain', display: 'block'});
      if (el) {
        const r = this.rect(el), scale = H.scaling(el);
        if (el.tagName === 'IMG') { el.src = data; el.alt = file.name; el.style.objectFit = 'contain'; }
        else {
          el.style.setProperty('width', r.width / scale.x + 'px', 'important'); el.style.setProperty('height', r.height / scale.y + 'px', 'important');
          el.style.position = 'relative'; el.replaceChildren(img); el.setAttribute('aria-label', file.name);
        }
      } else {
        el = this.frameDoc.createElement('div'); el.className = 'ppt-object'; el.dataset.pptId = H.uid();
        const factor = Math.min(400 / probe.naturalWidth, 300 / probe.naturalHeight, 1);
        const width = Math.max(12, probe.naturalWidth * factor), height = Math.max(12, probe.naturalHeight * factor);
        Object.assign(el.style, {position: 'absolute', left: (this.deck.width - width) / 2 + 'px', top: (this.deck.height - height) / 2 + 'px', width: width + 'px', height: height + 'px', zIndex: '10'});
        el.append(img); this.currentSlide().append(el);
      }
      this.select(el.dataset.pptId); this.commit(before, replaceId ? '替换图片' : '插入图片');
    }
    duplicate() {
      this.mutate('复制对象', original => {
        const r = this.rect(original), css = getComputedStyle(original), clone = original.cloneNode(true);
        clone.dataset.pptId = H.uid();
        clone.querySelectorAll('[data-ppt-id]').forEach(n => n.dataset.pptId = H.uid());
        const ids = new Map();
        [clone, ...clone.querySelectorAll('[id]')].filter(n => n.id).forEach(n => { const old = n.id; n.id = H.uid(); ids.set(old, n.id); });
        for (const n of [clone, ...clone.querySelectorAll('*')]) for (const attr of [...n.attributes]) {
          let value = attr.value;
          for (const [old, fresh] of ids) value = value.split(`url(#${old})`).join(`url(#${fresh})`).replace(new RegExp('^#' + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '#' + fresh);
          if (value !== attr.value) n.setAttribute(attr.name, value);
        }
        for (const prop of ['font-family','font-size','font-weight','font-style','line-height','color','text-align','white-space','padding','background-color','overflow-wrap','border-left']) clone.style.setProperty(prop, css.getPropertyValue(prop), 'important');
        Object.assign(clone.style, {position: 'absolute', left: r.x + 'px', top: r.y + 'px', width: css.width, height: css.height, translate: '24px 24px', transformOrigin: 'top left', zIndex: '20'});
        clone.style.setProperty('margin', '0', 'important');
        this.currentSlide().append(clone); this.selectedId = clone.dataset.pptId;
      });
    }
    delete() {
      this.mutate('删除对象', el => { el.remove(); this.selectedId = null; });
    }
    keydown(e) {
      if (!this.deck) return;
      const key = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (mod && key === 's') { e.preventDefault(); this.saveProject(); return; }
      if (e.key === 'Escape') {
        if (this.presenting) this.exitPresent();
        else if (this.interaction) this.finishInteraction(true);
        else if (this.editing) this.finishEdit();
        else this.select(null);
        e.preventDefault(); return;
      }
      const target = e.target;
      if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (this.presenting) {
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); this.showPage(this.page + 1); }
        if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); this.showPage(this.page - 1); }
        if (e.key === 'Home') this.showPage(0);
        if (e.key === 'End') this.showPage(this.deck.slides.length - 1);
        return;
      }
      if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); this.redo(); return; }
      if (mod && key === 'd') { e.preventDefault(); this.duplicate(); return; }
      if (e.key === 'F2') { e.preventDefault(); this.beginTextEdit(this.selected()); return; }
      if (['Delete', 'Backspace'].includes(e.key) && this.selected()) { e.preventDefault(); this.delete(); return; }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && this.selected() && !mod && !e.altKey) {
        e.preventDefault(); const amount = e.shiftKey ? 10 : 1;
        this.mutate('微调位置', el => {
          const r = this.rect(el); this.setPosition(el, r.x + (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0), r.y + (e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0));
        }); return;
      }
      if (e.key === 'PageDown') { e.preventDefault(); this.showPage(this.page + 1); }
      if (e.key === 'PageUp') { e.preventDefault(); this.showPage(this.page - 1); }
    }
    queueSave() {
      this.pendingSave = true; this.draftState = 'saving'; this.updateSaveStatus();
      clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveDraft(), 650);
    }
    async saveDraft() {
      clearTimeout(this.saveTimer); if (!this.deck) return;
      const token = this.loadToken, revision = this.revision, project = this.deck.project();
      const key = this.serverFile ? this.workspace.draftKey(this.serverFile.path) : 'current';
      if (this.serverFile) project.workspace = {path: this.serverFile.path, revision: this.serverFile.revision, dirty: this.diskDirty()};
      this.saveChain = this.saveChain.catch(() => {}).then(() => this.store.write(project, key));
      try {
        await this.saveChain;
        if (token === this.loadToken && revision === this.revision) {
          this.savedRevision = revision; this.pendingSave = false;
          this.draftState = 'saved'; this.updateSaveStatus();
        }
      } catch {
        if (token === this.loadToken) { this.draftState = 'failed'; this.updateSaveStatus(); }
      }
    }
    saveProject() {
      if (this.serverFile) return this.saveServer();
      this.downloadProject();
    }
    downloadProject() {
      if (!this.deck) return; this.finishEdit(); this.finishInteraction();
      download(this.deck.filename.replace(/\.html?$/i, '') + '.html-ppt.json', JSON.stringify(this.deck.project(), null, 2), 'application/json');
      this.toast('项目文件已下载，可在这里重新打开继续编辑'); this.saveDraft();
    }
    async saveServer() {
      if (!this.deck || !this.serverFile || this.savingToServer) return;
      this.finishEdit(); this.finishInteraction();
      const token = this.loadToken, revision = this.revision;
      const file = {...this.serverFile};
      const content = file.kind === 'project' ? JSON.stringify(this.deck.project(), null, 2) : this.deck.html();
      this.savingToServer = true; $('save-project').disabled = true; this.updateSaveStatus();
      try {
        const result = await this.workspace.save(file, content);
        if (token !== this.loadToken) return;
        this.serverFile.revision = result.revision; this.diskSavedRevision = revision;
        this.lastServerError = null; $('workspace-draft').hidden = true; this.recoverableDraft = null;
        this.toast(result.unchanged ? '服务器文件没有变化' : '已保存到 ' + file.path + '，原版本已自动备份');
        await this.saveDraft();
        return result;
      } catch (err) {
        this.lastServerError = err.status || true;
        this.toast(err.message); await this.saveDraft();
        if (token === this.loadToken) $('save-status').textContent = err.status === 409 ? '保存冲突 · 文件已被其他程序修改' : '服务器保存失败 · 修改仍保留在编辑器';
        return null;
      } finally {
        this.savingToServer = false;
        if (token === this.loadToken) {
          $('save-project').disabled = false;
          if (!this.lastServerError) this.updateSaveStatus();
        }
      }
    }
    exportHtml() {
      if (!this.deck) return null; this.finishEdit(); this.finishInteraction();
      const html = this.deck.html();
      download(this.deck.filename.replace(/\.html?$/i, '') + '-edited.html', html, 'text/html;charset=utf-8');
      this.toast('HTML 已导出，直接用浏览器打开即可演示'); return html;
    }
    audit() {
      if (!this.frameDoc) return [];
      const issues = [];
      this.frameDoc.querySelectorAll('.slide').forEach((slide, page) => {
        slide.setAttribute('data-ppt-active', '');
        const sr = slide.getBoundingClientRect();
        slide.querySelectorAll('[data-ppt-id]').forEach(el => {
          const r = el.getBoundingClientRect(), text = labelFor(el).slice(0, 45);
          if (r.left < sr.left - 1 || r.top < sr.top - 1 || r.right > sr.left + this.deck.width + 1 || r.bottom > sr.top + this.deck.height + 1) issues.push({page, id: el.dataset.pptId, kind: 'bounds', message: '对象超出页面边界', text});
          if (H.kind(el) === 'text' && (el.scrollWidth > el.clientWidth + 2 || (el.style.height && el.scrollHeight > el.clientHeight + 2))) issues.push({page, id: el.dataset.pptId, kind: 'text-overflow', message: '文字超出文本框', text});
        });
        slide.querySelectorAll('img').forEach(img => {
          if (!img.complete || !img.naturalWidth) issues.push({page, id: img.closest('[data-ppt-id]')?.dataset.pptId, kind: 'image', message: '图片未能加载', text: img.alt || '图片'});
        });
        if (page !== this.page) slide.removeAttribute('data-ppt-active');
      });
      return issues;
    }
    refreshAudit() {
      const issues = this.audit(); this.issues = issues;
      $('audit-label').textContent = issues.length ? `${issues.length} 项布局提醒` : '布局检查';
      $('audit').classList.toggle('has-issues', !!issues.length);
      this.updateSelection(); return issues;
    }
    showAudit() {
      const issues = this.refreshAudit(), list = $('audit-results'); list.replaceChildren();
      if (!issues.length) {
        const p = document.createElement('div'); p.className = 'audit-ok'; p.textContent = `已检查 ${this.deck.slides.length} 页，未发现页面越界、文字框溢出或图片加载错误。`; list.append(p);
      }
      issues.forEach(issue => {
        const button = document.createElement('button'); button.className = 'audit-row';
        button.textContent = `第 ${issue.page + 1} 页 · ${issue.message} — ${issue.text}`;
        button.onclick = () => { $('audit-dialog').close(); this.showPage(issue.page); this.select(issue.id); }; list.append(button);
      });
      $('audit-dialog').showModal();
    }
    async enterPresent() {
      if (!this.deck) return;
      this.finishEdit(); this.finishInteraction(); this.select(null); this.presenting = true;
      document.body.classList.add('presenting'); $('present-controls').hidden = false; this.fit();
      this.usedFullscreen = false;
      try { await document.documentElement.requestFullscreen(); this.usedFullscreen = true; } catch { /* Embedded browsers still support the full-window presentation. */ }
    }
    exitPresent() {
      this.presenting = false; this.usedFullscreen = false; document.body.classList.remove('presenting'); $('present-controls').hidden = true;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      this.fit();
    }
  }
  const editor = new Editor(); window.pptEditor = editor;
  editor.ready = editor.start().catch(err => { editor.toast('打开失败：' + err.message); $('save-status').textContent = '打开失败'; throw err; });
})();
