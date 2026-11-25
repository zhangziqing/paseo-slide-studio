import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {editorDocument} from '../shared/editor-document.ts';
import {packedDeck, plainDeck, replacement} from './fixtures/packed-deck.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const editor = 'document.getElementById("panel").contentWindow.pptEditor';
const panelWindow = 'document.getElementById("panel").contentWindow';

// Use the generated plugin UI and its real sandboxed canvas. The host fixture
// only implements read-only file RPC, so no separate asset server is needed.
function hostDocument() {
  return `<!doctype html><html><body><iframe id="panel" sandbox="allow-scripts allow-same-origin allow-downloads allow-modals" style="width:1400px;height:900px"></iframe>
<script id="fixture" type="application/json">${json({editorDocument, content: packedDeck})}</script><script>
const fixture = JSON.parse(document.getElementById('fixture').textContent);
const panel = document.getElementById('panel'); window.writes = 0; window.hostErrors = [];
addEventListener('message', event => {
  const message = event.data;
  if (event.source !== panel.contentWindow || message?.namespace !== 'paseo-slide-studio') return;
  const send = body => panel.contentWindow.postMessage({namespace: message.namespace, nonce: 'test', ...body}, '*');
  if (message.type === 'ready') { send({type: 'init', path: 'talk/presentation.html', colors: {}}); return; }
  if (message.type === 'error') { hostErrors.push(message.message); return; }
  if (message.type !== 'request') return;
  let result = {status: 200, data: {}};
  if (message.request.method === 'info') result.data = {name: 'fixture', id: 'packed-images'};
  else if (message.request.method === 'read') result.data = {path: 'talk/presentation.html', kind: 'html', content: fixture.content, revision: '0'.repeat(64), base_url: 'https://paseo-slide-studio.invalid/files/talk/'};
  else { if (message.request.method === 'save') writes++; result = {status: 403, data: {error: 'Read-only fixture'}}; }
  send({type: 'response', id: message.id, result});
});
panel.srcdoc = fixture.editorDocument;
</script></body></html>`;
}

async function browserSession(t) {
  assert.ok(process.env.CHROME_BIN, 'Set CHROME_BIN to a Chrome/Chromium executable for browser tests.');
  const directory = await mkdtemp(join(tmpdir(), 'slide-studio-packed-'));
  const profile = join(directory, 'profile');
  const child = spawn(process.env.CHROME_BIN, ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  let ws, stderr = '', launchError, sequence = 0;
  const pending = new Map(), errors = [], requests = [];
  child.stderr.on('data', value => { stderr += value; });
  child.on('error', error => { launchError = error; });
  t.after(async () => {
    for (const item of pending.values()) clearTimeout(item.timer);
    ws?.close(); child.kill('SIGTERM'); await sleep(100);
    await rm(directory, {recursive: true, force: true});
  });
  let endpoint;
  for (let i = 0; i < 150; i++) {
    if (launchError) throw launchError;
    endpoint = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    if (endpoint || child.exitCode !== null) break;
    await sleep(50);
  }
  assert.ok(endpoint, 'Chromium did not start: ' + stderr);
  const origin = endpoint.replace(/^ws:/, 'http:').split('/devtools/')[0];
  const target = await (await fetch(origin + '/json/new?about:blank', {method: 'PUT'})).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    else if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url)) requests.push(message.params.request.url);
  };
  function call(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      pending.set(id, {resolve, reject, timer}); ws.send(JSON.stringify({id, method, params}));
    });
  }
  async function evaluate(expression, awaitPromise = false) {
    const result = await call('Runtime.evaluate', {expression, awaitPromise, returnByValue: true, userGesture: true});
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function waitFor(expression) {
    for (let i = 0; i < 180; i++) { if (await evaluate(expression)) return; await sleep(50); }
    throw new Error('Timed out: ' + expression);
  }
  async function navigate(filename, suffix = '') { await call('Page.navigate', {url: pathToFileURL(join(directory, filename)).href + suffix}); }
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable'); await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false});
  await call('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
  return {directory, call, evaluate, waitFor, navigate, errors, requests};
}

test('packed images survive the sandboxed editor, compact save, and export', {timeout: 60000}, async t => {
  const b = await browserSession(t);
  await writeFile(join(b.directory, 'host.html'), hostDocument());
  await b.navigate('host.html');
  await b.waitFor('Boolean(document.getElementById("panel")?.contentWindow?.pptEditor?.frameDoc)');
  await b.evaluate(`${editor}.ready`, true);
  await b.evaluate(`Promise.all([...${editor}.frameDoc.images].map(image => image.decode().catch(() => {})))`, true);

  await t.test('loads packed SVG/PNG, repeated images, and shared fonts without executing document scripts', async () => {
    const state = await b.evaluate(`(async () => {
      const e = ${editor}, images = [...e.frameDoc.images];
      await e.frameDoc.fonts.load('400 20px PackedTest');
      return {pages: e.deck.slides.length, images: images.length, loaded: images.filter(i => i.complete && i.naturalWidth).length,
        scripts: e.frameDoc.scripts.length, executed: Boolean(e.frame.contentWindow.__deckScriptExecuted),
        font: e.frameDoc.fonts.check('400 20px PackedTest'), errors: hostErrors, writes};
    })()`, true);
    assert.deepEqual(state, {pages: 3, images: 5, loaded: 5, scripts: 0, executed: false, font: true, errors: [], writes: 0});
    const svg = await b.evaluate(`atob(${editor}.frameDoc.querySelector('img[data-deck-asset="vector"]').src.split(',')[1])`);
    assert.ok(svg.includes('data:font/woff;base64,')); assert.ok(!svg.includes('__DECK_FONT_0__'));
  });

  await t.test('loads thumbnails and shows the complete static animation image', async () => {
    const state = await b.evaluate(`(async () => {
      const w = ${panelWindow}, images = [...w.document.querySelectorAll('.thumb-preview')].flatMap(p => [...p.shadowRoot.querySelectorAll('img')]);
      await Promise.all(images.map(i => i.decode().catch(() => {})));
      const image = ${editor}.frameDoc.querySelector('img[data-deck-still]');
      return {images: images.length, loaded: images.filter(i => i.complete && i.naturalWidth).length, static: image.dataset.deckResolved === image.dataset.deckStill};
    })()`, true);
    assert.deepEqual(state, {images: 5, loaded: 5, static: true});
  });

  await t.test('compacts saves and reopens HTML and project files without expanding font copies', async () => {
    const state = await b.evaluate(`(() => {
      const w = ${panelWindow}, e = w.pptEditor, html = e.deck.html(), raw = new DOMParser().parseFromString(html, 'text/html');
      const again = new w.HtmlPpt.DeckDocument(html), project = w.HtmlPpt.DeckDocument.fromProject(e.deck.project());
      window.exported = html;
      return {packedSources: [...raw.querySelectorAll('img[data-deck-asset]')].filter(i => i.hasAttribute('src')).length,
        reopened: [...again.doc.querySelectorAll('img[data-deck-asset]')].filter(i => i.src.startsWith('data:')).length,
        project: [...project.doc.querySelectorAll('img[data-deck-asset]')].filter(i => i.src.startsWith('data:')).length,
        copies: html.split('data:font/woff;base64,').length - 1, loader: Boolean(raw.getElementById('ppt-packed-images'))};
    })()`);
    assert.deepEqual(state, {packedSources: 0, reopened: 4, project: 4, copies: 1, loader: true});
  });

  await t.test('image replacements survive saves and ordinary HTML decks still work', async () => {
    const state = await b.evaluate(`(() => {
      const w = ${panelWindow}, deck = new w.HtmlPpt.DeckDocument(w.pptEditor.deck.html());
      const image = deck.doc.querySelector('img[data-deck-asset="vector"]'); image.src = ${json(replacement)};
      const again = new w.HtmlPpt.DeckDocument(deck.html()), replaced = again.doc.querySelector('.figure img');
      const ordinary = new w.HtmlPpt.DeckDocument(${json(plainDeck)}), saved = ordinary.html();
      return {replacement: replaced.getAttribute('src') === ${json(replacement)}, detached: !replaced.hasAttribute('data-deck-asset'),
        ordinary: new DOMParser().parseFromString(saved, 'text/html').querySelector('img').getAttribute('src') === ${json(replacement)}};
    })()`);
    assert.deepEqual(state, {replacement: true, detached: true, ordinary: true});
  });

  await writeFile(join(b.directory, 'export.html'), await b.evaluate('exported'));
  await t.test('exported HTML decodes all images and CSS-only embedded font faces', async () => {
    await b.navigate('export.html', '?capture=1'); await b.waitFor('Boolean(window.deckReady)');
    const qa = await b.evaluate('window.deckReady', true);
    assert.equal(qa.status, 'passed', JSON.stringify(qa.issues)); assert.equal(qa.pages, 3);
    assert.ok(qa.fonts.every(font => font.loaded));
    assert.equal(await b.evaluate('[...document.images].filter(i => i.complete && i.naturalWidth).length'), 5);
  });

  await t.test('normal export switches live/static images on navigation, overview, reduced motion, and print', async () => {
    await b.navigate('export.html'); await b.waitFor('Boolean(window.deckReady)'); await b.evaluate('window.deckReady', true);
    const resolved = () => b.evaluate('document.querySelector("img[data-deck-still]").dataset.deckResolved');
    assert.equal(await resolved(), 'still');
    await b.evaluate('deck.show(1)'); assert.equal(await resolved(), 'live');
    await b.evaluate('document.getElementById("overview").click()'); assert.equal(await resolved(), 'still');
    await b.evaluate('document.getElementById("overview").click()'); assert.equal(await resolved(), 'live');
    await b.call('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
    await b.waitFor('document.querySelector("img[data-deck-still]").dataset.deckResolved === "still"');
    await b.call('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
    await b.waitFor('document.querySelector("img[data-deck-still]").dataset.deckResolved === "live"');
    await b.evaluate('dispatchEvent(new Event("beforeprint"))'); assert.equal(await resolved(), 'still');
    await b.evaluate('dispatchEvent(new Event("afterprint"))'); assert.equal(await resolved(), 'live');
    await b.evaluate('deck.show(0)'); assert.equal(await resolved(), 'still');
  });
  assert.deepEqual(b.errors, []); assert.deepEqual(b.requests, []);
});
