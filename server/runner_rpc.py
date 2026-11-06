"""Use the existing Workspace implementation over stdio, without an HTTP listener."""
import base64
import json
import mimetypes
import sys
from pathlib import Path
from server import FileError, MAX_FILE, Workspace

workspace = Workspace(sys.argv[1])


def execute(request):
    method = request['method']
    if method == 'info':
        return {'format': 'html-ppt-workspace', 'version': 1,
                'name': workspace.root.name, 'id': workspace.id}
    # File-panel handles use absolute host paths; Workspace still validates all
    # visible path components and symlink targets after making them relative.
    request = dict(request)
    if Path(request.get('path', '')).is_absolute():
        try:
            request['path'] = Path(request['path']).relative_to(workspace.root).as_posix()
        except ValueError:
            raise FileError('只能访问当前工作区内的文件', 403)
    if method == 'list':
        return workspace.listing(request['path'])
    if method == 'read':
        result = workspace.read(request['path'])
        result['base_url'] = 'https://paseo-slide-studio.invalid' + result['base_url']
        return result
    if method == 'save':
        return workspace.save(request['path'], request['revision'], request['content'])
    if method == 'asset':
        path = workspace.path(request['path'], allow_root=False)
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        if not (mime.startswith(('image/', 'font/')) or mime == 'text/css'
                or path.suffix.lower() in {'.woff', '.woff2', '.ttf', '.otf'}):
            raise FileError('只能读取幻灯片需要的图片、字体和样式资源', 403)
        if not path.is_file():
            raise FileError('请选择资源文件', 400)
        if path.stat().st_size > MAX_FILE:
            raise FileError('资源超过 64 MiB', 413)
        return {'mime': mime, 'base64': base64.b64encode(path.read_bytes()).decode('ascii')}
    raise FileError('未知的编辑器请求')


print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    message = {}
    try:
        message = json.loads(line)
        response = {'status': 200, 'data': execute(message['request'])}
    except FileError as error:
        response = {'status': error.status, 'data': {'error': str(error)}}
    except (OSError, ValueError, KeyError, TypeError):
        response = {'status': 500, 'data': {'error': '无法读写文件，请检查工作区目录和文件权限'}}
    print(json.dumps({'id': message.get('id'), **response}, ensure_ascii=False), flush=True)
