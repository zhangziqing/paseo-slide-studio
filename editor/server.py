#!/usr/bin/env python3
"""Serve Slide Studio and read/write presentation files inside one workspace."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import stat
import tempfile
import threading
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, quote, unquote, urlsplit

APP = Path(__file__).resolve().parent
API = '/api/ppt/'
MAX_FILE = 64 * 1024 * 1024
SKIP = {'node_modules', '__pycache__'}


class FileError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class SlideParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = False

    def handle_starttag(self, tag, attrs):
        if 'slide' in dict(attrs).get('class', '').split():
            self.found = True


def kind(path):
    if path.name.lower().endswith('.html-ppt.json'):
        return 'project'
    if path.suffix.lower() in {'.html', '.htm'}:
        return 'html'
    raise FileError('只能编辑 HTML PPT 或 .html-ppt.json 项目文件')


def validate(content, file_kind):
    if not isinstance(content, str) or len(content.encode('utf-8')) > MAX_FILE:
        raise FileError('文件为空或超过 64 MiB')
    html = content
    if file_kind == 'project':
        try:
            project = json.loads(content)
        except (ValueError, TypeError) as exc:
            raise FileError('项目 JSON 无效') from exc
        if not isinstance(project, dict) or project.get('format') != 'html-ppt-project' or project.get('version') != 1 or not isinstance(project.get('html'), str):
            raise FileError('不是受支持的 HTML PPT 项目文件')
        html = project['html']
    parser = SlideParser()
    parser.feed(html)
    if not parser.found:
        raise FileError('文件中没有 .slide 页面，请选择 HTML PPT')


def digest(data):
    return hashlib.sha256(data).hexdigest()


class Workspace:
    def __init__(self, root):
        self.root = Path(root).resolve(strict=True)
        if not self.root.is_dir():
            raise ValueError('工作区必须是目录')
        self.token = secrets.token_urlsafe(32)
        self.id = digest(str(self.root).encode())[:24]
        self.lock = threading.RLock()

    def path(self, relative='', *, allow_root=True):
        if not isinstance(relative, str) or '\\' in relative or '\0' in relative:
            raise FileError('文件路径无效')
        pieces = PurePosixPath(relative)
        if pieces.is_absolute() or any(p == '..' or p.startswith('.') or p in SKIP for p in pieces.parts):
            raise FileError('只能访问工作区内的可见文件', 403)
        try:
            path = (self.root / relative).resolve(strict=True)
        except (FileNotFoundError, OSError, RuntimeError) as exc:
            raise FileError('文件或目录不存在', 404) from exc
        if not path.is_relative_to(self.root) or path == APP or APP in path.parents:
            raise FileError('不能访问工作区以外的文件或编辑器程序目录', 403)
        if any(p.startswith('.') for p in path.relative_to(self.root).parts):
            raise FileError('不能访问隐藏文件', 403)
        if not allow_root and path == self.root:
            raise FileError('请选择文件')
        return path

    def relative(self, path):
        return path.relative_to(self.root).as_posix()

    def listing(self, relative=''):
        directory = self.path(relative)
        if not directory.is_dir():
            raise FileError('请选择目录')
        entries = []
        for child in directory.iterdir():
            if child.name.startswith('.') or child.name in SKIP:
                continue
            try:
                path = self.path(self.relative(child))
                is_dir = path.is_dir()
                if not is_dir and not path.is_file():
                    continue
                file_kind = 'directory' if is_dir else kind(path)
                info = path.stat()
                entries.append({'name': child.name, 'path': self.relative(child), 'kind': file_kind,
                                'size': info.st_size, 'modified': info.st_mtime})
            except (FileError, OSError):
                continue
        entries.sort(key=lambda e: (e['kind'] != 'directory', e['name'].casefold()))
        return {'path': '' if directory == self.root else self.relative(directory), 'entries': entries}

    def read(self, relative):
        path = self.path(relative, allow_root=False)
        if not path.is_file():
            raise FileError('请选择文件')
        file_kind = kind(path)
        if path.stat().st_size > MAX_FILE:
            raise FileError('文件超过 64 MiB', 413)
        data = path.read_bytes()
        try:
            content = data.decode('utf-8-sig')
        except UnicodeDecodeError as exc:
            raise FileError('请使用 UTF-8 编码的文件') from exc
        validate(content, file_kind)
        relative = self.relative(path)
        parent = path.parent.relative_to(self.root).as_posix()
        base_url = '/files/' + (quote(parent, safe='/') + '/' if parent != '.' else '')
        return {'path': relative, 'kind': file_kind, 'content': content, 'revision': digest(data),
                'base_url': base_url, 'url': '/files/' + quote(relative, safe='/')}

    def save(self, relative, expected_revision, content):
        if not isinstance(expected_revision, str) or len(expected_revision) != 64:
            raise FileError('保存需要打开文件时的版本标识')
        with self.lock:
            current = self.read(relative)
            if current['revision'] != expected_revision:
                raise FileError('服务器文件已被其他窗口或程序修改。请重新打开服务器文件；当前修改可先下载项目备份。', 409)
            path = self.path(current['path'], allow_root=False)
            validate(content, current['kind'])
            new = content.encode('utf-8')
            old = path.read_bytes()
            # Recheck after validation, in case an external tool rebuilt the deck.
            if digest(old) != expected_revision:
                raise FileError('服务器文件在保存前发生变化，请重新打开后再试', 409)
            if new == old:
                return {'path': current['path'], 'revision': expected_revision, 'backup': None, 'unchanged': True}
            backup_root = self.root / '.ppt-backups'
            if backup_root.is_symlink():
                raise FileError('备份目录不能是符号链接', 403)
            # Backups are flat: no untrusted directory components are followed.
            backup_root.mkdir(mode=0o700, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
            backup = backup_root / f'{path.stem}-{digest(current["path"].encode())[:10]}-{stamp}-{secrets.token_hex(4)}{path.suffix}'
            with backup.open('xb') as stream:
                stream.write(old)
                stream.flush()
                os.fsync(stream.fileno())
            fd, temp_name = tempfile.mkstemp(prefix='.' + path.name + '-', suffix='.tmp', dir=path.parent)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(new)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.chmod(temp_name, stat.S_IMODE(path.stat().st_mode))
                if digest(path.read_bytes()) != expected_revision:
                    raise FileError('服务器文件在保存前发生变化，请重新打开后再试', 409)
                os.replace(temp_name, path)
            finally:
                Path(temp_name).unlink(missing_ok=True)
            return {'path': current['path'], 'revision': digest(new),
                    'backup': backup.relative_to(self.root).as_posix(), 'unchanged': False}


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, workspace):
        self.workspace = workspace
        super().__init__(address, Handler)


class Handler(SimpleHTTPRequestHandler):
    server_version = 'SlideStudio/1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        super().end_headers()

    def json_response(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def check_origin(self, write=False):
        origin = self.headers.get('Origin')
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in {'http', 'https'} or parsed.netloc != self.headers.get('Host'):
                raise FileError('不接受来自其他网站的文件操作', 403)
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            raise FileError('不接受来自其他网站的文件操作', 403)
        if write and not secrets.compare_digest(self.headers.get('X-PPT-Token', ''), self.server.workspace.token):
            raise FileError('保存凭据已失效，请刷新编辑器重试', 403)

    def do_GET(self):
        self.serve_get()

    def do_HEAD(self):
        self.serve_get()

    def serve_get(self):
        self.__dict__.pop('_target', None)
        request = urlsplit(self.path)
        try:
            if request.path.startswith(API):
                self.check_origin()
                workspace = self.server.workspace
                relative = parse_qs(request.query, keep_blank_values=True).get('path', [''])[0]
                if request.path == API + 'info':
                    value = {'format': 'html-ppt-workspace', 'version': 1, 'name': workspace.root.name,
                             'id': workspace.id, 'token': workspace.token}
                elif request.path == API + 'files':
                    value = workspace.listing(relative)
                elif request.path == API + 'file':
                    value = workspace.read(relative)
                else:
                    raise FileError('文件接口不存在', 404)
                self.json_response(200, value)
                return
            if request.path in {'/', '/html-ppt-editor', '/html-ppt-editor/'}:
                self.path = '/index.html'
                super().do_GET() if self.command == 'GET' else super().do_HEAD()
                return
            if request.path.startswith('/files/'):
                target = self.server.workspace.path(unquote(request.path[len('/files/'):]), allow_root=False)
            else:
                relative = unquote(request.path.removeprefix('/html-ppt-editor/').lstrip('/'))
                # Only the app's browser assets are served from its own directory.
                if relative in {'index.html', 'editor.html'} or relative in {'src/core.js', 'src/editor.js', 'src/editor.css', 'src/runtime.js', 'src/workspace.js'}:
                    target = APP / relative
                else:
                    # Keep direct /<deck-directory>/presentation.html links working.
                    target = self.server.workspace.path(unquote(request.path.lstrip('/')), allow_root=False)
            if not target.is_file():
                raise FileError('文件不存在', 404)
            self.path = '/' + quote(target.name)
            self._target = str(target)
            super().do_GET() if self.command == 'GET' else super().do_HEAD()
        except FileError as exc:
            self.json_response(exc.status, {'error': str(exc)})
        except OSError:
            self.json_response(500, {'error': '无法读写文件，请检查服务器目录权限'})

    def translate_path(self, path):
        return getattr(self, '_target', super().translate_path(path))

    def do_PUT(self):
        try:
            if urlsplit(self.path).path != API + 'file':
                raise FileError('文件接口不存在', 404)
            self.check_origin(write=True)
            if self.headers.get_content_type() != 'application/json':
                raise FileError('保存请求需要 application/json', 415)
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError as exc:
                raise FileError('请求长度无效') from exc
            if length <= 0 or length > MAX_FILE * 2:
                raise FileError('请求为空或超过大小限制', 413)
            try:
                body = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError) as exc:
                raise FileError('保存请求 JSON 无效') from exc
            if not isinstance(body, dict):
                raise FileError('保存请求无效')
            value = self.server.workspace.save(body.get('path'), body.get('revision'), body.get('content'))
            self.json_response(200, value)
        except FileError as exc:
            self.json_response(exc.status, {'error': str(exc)})
        except OSError:
            self.json_response(500, {'error': '保存失败，请检查服务器目录和备份目录的写入权限'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('port', type=int, nargs='?', default=8000)
    parser.add_argument('--bind', default='0.0.0.0', help='监听地址，默认允许工作电脑访问')
    parser.add_argument('--directory', type=Path, default=APP.parent, help='可编辑文件的根目录，默认 slides')
    args = parser.parse_args()
    server = Server((args.bind, args.port), Workspace(args.directory))
    print(f'Slide Studio: http://{args.bind}:{server.server_port}/html-ppt-editor/', flush=True)
    print(f'Workspace: {server.workspace.root}', flush=True)
    print('Ctrl+C stops the server. Saving creates a backup in .ppt-backups/.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
