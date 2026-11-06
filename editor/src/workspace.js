/* Same-origin file API. The offline editor keeps using local files. */
(() => {
  'use strict';
  class WorkspaceClient {
    constructor() { this.info = null; }
    get connected() { return !!this.info; }
    async request(route, options = {}) {
      const response = await fetch('/api/ppt/' + route, {cache: 'no-store', ...options});
      let result;
      try { result = await response.json(); } catch { throw new Error('文件服务未响应，请使用 server.py 启动服务'); }
      if (!response.ok) { const error = new Error(result.error || '文件请求失败'); error.status = response.status; throw error; }
      return result;
    }
    async connect() {
      if (!/^https?:$/.test(location.protocol)) return false;
      try {
        const info = await this.request('info', {signal: AbortSignal.timeout(4000)});
        if (info.format !== 'html-ppt-workspace' || info.version !== 1) return false;
        this.info = info; return true;
      } catch { return false; }
    }
    list(path = '') { return this.request('files?path=' + encodeURIComponent(path)); }
    read(path) { return this.request('file?path=' + encodeURIComponent(path)); }
    save(file, content) {
      return this.request('file', {method: 'PUT', headers: {'Content-Type': 'application/json', 'X-PPT-Token': this.info.token},
        body: JSON.stringify({path: file.path, revision: file.revision, content})});
    }
    draftKey(path) { return 'workspace:' + this.info.id + ':' + path; }
  }
  window.HtmlPpt.WorkspaceClient = WorkspaceClient;
})();
