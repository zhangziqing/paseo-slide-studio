import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceWorkers, Worker } from '../server/workers.ts';
import { editorAssets } from '../server/editor-assets.ts';

const html = '<!doctype html><title>Plugin test</title><section class="slide" style="width:960px;height:540px"><div class="para">原始内容</div></section>';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'slide-studio-rpc-test-'));
  const root = join(directory, 'slides');
  await mkdir(join(root, '演示 文档'), { recursive: true });
  const file = join(root, '演示 文档', 'presentation.html');
  await writeFile(file, html);
  const workers = new WorkspaceWorkers();
  t.after(async () => { await workers.close(); await rm(directory, { recursive: true, force: true }); });
  const request = request => workers.request(root, 'python3', request);
  return { directory, root, file, workers, request };
}

test('RPC opens Unicode and absolute file-panel paths, saves with exact backup, and rejects stale writes', async t => {
  const f = await fixture(t);
  const opened = await f.request({ method: 'read', path: f.file });
  assert.equal(opened.status, 200);
  assert.equal(opened.data.path, '演示 文档/presentation.html');
  assert.equal(opened.data.base_url, 'https://paseo-slide-studio.invalid/files/%E6%BC%94%E7%A4%BA%20%E6%96%87%E6%A1%A3/');
  const changed = html.replace('原始内容', '内置编辑器保存');
  const save = content => f.request({ method: 'save', path: opened.data.path, revision: opened.data.revision, content });
  const saved = await save(changed);
  assert.equal(saved.status, 200);
  assert.equal(await readFile(f.file, 'utf8'), changed);
  assert.equal(await readFile(join(f.root, saved.data.backup), 'utf8'), html);
  assert.equal((await save(html)).status, 409);
  assert.equal(await readFile(f.file, 'utf8'), changed);
});

test('parallel operations reuse a stdio worker with no network sockets; teardown closes it', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.request({ method: 'info' })));
  assert.ok(results.every(result => result.status === 200 && result.data.id === results[0].data.id));
  assert.equal(f.workers.workers.size, 1);
  const worker = await [...f.workers.workers.values()][0];
  if (process.platform === 'linux') {
    const folder = '/proc/' + worker.child.pid + '/fd';
    // Node implements the three stdio pipes with Unix socket pairs on Linux.
    const descriptors = (await readdir(folder)).filter(name => Number(name) > 2);
    const links = await Promise.all(descriptors.map(name => readlink(join(folder, name)).catch(() => '')));
    assert.equal(links.some(link => link.startsWith('socket:')), false);
  }
  const exited = once(worker.child, 'exit');
  await f.workers.close(); await exited;
  assert.equal(worker.alive, false);
  await assert.rejects(f.request({ method: 'info' }), /已停止/);
});

test('workspace boundaries, hidden files, symlinks, unsupported documents and assets are enforced', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'outside.html'), html);
  await symlink(join(f.directory, 'outside.html'), join(f.root, 'escape.html'));
  await writeFile(join(f.root, '.secret.html'), html);
  await writeFile(join(f.root, 'source.py'), 'pass');
  await writeFile(join(f.root, 'website.html'), '<html>Ordinary site</html>');
  for (const path of ['../outside.html', 'escape.html', '.secret.html', join(f.directory, 'outside.html')]) {
    assert.equal((await f.request({ method: 'read', path })).status, 403);
  }
  assert.equal((await f.request({ method: 'read', path: 'missing.html' })).status, 404);
  for (const path of ['source.py', 'website.html']) assert.equal((await f.request({ method: 'read', path })).status, 400);
  assert.equal((await f.request({ method: 'asset', path: 'source.py' })).status, 403);
  const listing = await f.request({ method: 'list', path: '' });
  assert.equal(listing.status, 200);
  assert.ok(!listing.data.entries.some(entry => entry.name.startsWith('.') || entry.name === 'escape.html'));
});

test('relative image, CSS and font resources travel as RPC data, and projects keep the same save safety', async t => {
  const f = await fixture(t);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>';
  await writeFile(join(f.root, 'picture.svg'), svg);
  await writeFile(join(f.root, 'theme.css'), '.slide{background:url(picture.svg)}');
  await writeFile(join(f.root, 'font.woff2'), Buffer.from([1, 2, 3]));
  for (const path of ['picture.svg', 'theme.css', 'font.woff2']) {
    const resource = await f.request({ method: 'asset', path });
    assert.equal(resource.status, 200);
    assert.deepEqual(Buffer.from(resource.data.base64, 'base64'), await readFile(join(f.root, path)));
  }
  const project = { format: 'html-ppt-project', version: 1, html, filename: 'presentation.html' };
  await writeFile(join(f.root, 'deck.html-ppt.json'), JSON.stringify(project));
  const opened = await f.request({ method: 'read', path: 'deck.html-ppt.json' });
  assert.equal(opened.data.kind, 'project');
  const saved = await f.request({ method: 'save', path: opened.data.path, revision: opened.data.revision, content: JSON.stringify({ ...project, html: html.replace('原始内容', '项目修改') }) });
  assert.equal(saved.status, 200);
  assert.equal(await readFile(join(f.root, saved.data.backup), 'utf8'), JSON.stringify(project));
});

test('missing Python is recoverable, and different workspaces stay separate', async t => {
  const f = await fixture(t);
  await assert.rejects(f.workers.request(f.root, join(f.directory, 'missing-python'), { method: 'info' }), /无法启动 Python/);
  assert.equal((await f.request({ method: 'info' })).status, 200);
  const other = join(f.directory, 'another'); await mkdir(other);
  const [a, b] = await Promise.all([f.request({ method: 'info' }), f.workers.request(other, 'python3', { method: 'info' })]);
  assert.notEqual(a.data.id, b.data.id);
  assert.equal(f.workers.workers.size, 2);
});

test('parent EOF ends the Python worker without requiring a socket or explicit signal', async t => {
  const f = await fixture(t);
  const assets = join(f.directory, 'assets'); await mkdir(assets);
  for (const name of ['server.py', 'runner_rpc.py']) await writeFile(join(assets, name), editorAssets[name]);
  const worker = new Worker(assets, f.root, 'python3');
  t.after(() => worker.close());
  assert.equal((await worker.request({ method: 'info' })).status, 200);
  const exited = once(worker.child, 'exit'); worker.child.stdin.end(); await exited;
  assert.equal(worker.alive, false);
});
