#!/usr/bin/env python3
"""Generate a self-contained HTML slide deck using measured template regions."""
import argparse
import base64
import hashlib
import html
import json
import mimetypes
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlsplit

from outline import parse
from fonts import embed_font

SKILL = Path(__file__).resolve().parent.parent
STAR = '<span class="sparkle" aria-label="AI generated"></span>'


def escape(value):
    return html.escape(str(value), quote=True)


def safe_link(url):
    value = html.unescape(url).strip()
    if any(ord(c) < 32 for c in value) or urlsplit(value).scheme.lower() not in ('', 'https', 'http', 'mailto'):
        raise ValueError('Unsupported link URL: ' + value)
    return escape(value)


def inline(text):
    """Render only the shared inline dialect; raw HTML is always literal."""
    out, pos = [], 0
    token = re.compile(r'(`+)(.*?)\1|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)|\{color:#([0-9a-fA-F]{6})\}(.*?)\{/color\}|\{blue\}(.*?)\{/blue\}', re.S)
    for m in token.finditer(text):
        out.append(escape(text[pos:m.start()]))
        g = m.groups()
        if g[0]:
            out.append('<code>' + escape(g[1]) + '</code>')
        elif g[2] is not None:
            out.append('<strong>' + inline(g[2]) + '</strong>')
        elif g[3] is not None:
            out.append('<a href="' + safe_link(g[4]) + '">' + inline(g[3]) + '</a>')
        elif g[5]:
            out.append('<span style="color:#' + g[5] + '">' + inline(g[6]) + '</span>')
        else:
            out.append('<span style="color:#7F7F7F">' + inline(g[7]) + '</span>')
        pos = m.end()
    out.append(escape(text[pos:]))
    return ''.join(out)


def data_uri(path):
    path = Path(path)
    if not path.is_file():
        raise ValueError('Missing asset: ' + str(path))
    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    if mime not in ('image/png', 'image/jpeg', 'image/svg+xml', 'image/gif', 'image/webp', 'font/woff', 'font/woff2', 'font/ttf', 'font/otf'):
        raise ValueError('Unsupported embedded asset type: ' + path.name)
    return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode('ascii')


def style(s):
    align = {'l': 'left', 'ctr': 'center', 'r': 'right', 'just': 'justify'}.get(s.get('align'), 'left')
    color = s.get('color', '000000')
    if not re.fullmatch('[0-9A-Fa-f]{6}', color):
        raise ValueError('Theme requires RGB colors')
    size = float(s['size'])
    return f'font-size:{size:g}px;line-height:{size * float(s.get("leading",1)):g}px;font-weight:{700 if s.get("bold") else 400};color:#{color};text-align:{align};'


def placeholder(ph, content, role, with_image=False):
    x, y, w, h = map(float, ph['box'])
    l, t, r, b = map(float, ph.get('margins', [0, 0, 0, 0]))
    justify = {'t': 'flex-start', 'ctr': 'center', 'b': 'flex-end'}.get(ph.get('anchor'), 'flex-start')
    return (f'<div class="placeholder" data-role="{escape(role)}" style="left:{x+l:g}px;top:{y+t:g}px;width:{w-l-r:g}px;height:{h-t-b:g}px;justify-content:{justify};{style(ph["styles"][0])}">'
            f'<div class="flow{" with-image" if with_image else ""}">{content}</div></div>')


def render_blocks(group, ph, source_dir, compact=False):
    out = []
    blocks = group['blocks']
    if group.get('heading'):
        blocks = [{'kind': 'paragraph', 'text': '**' + group['heading'] + '**', 'level': 0}] + blocks
    ai = False
    for block in blocks:
        kind = block['kind']
        if kind == 'paragraph':
            level = block.get('level', 0)
            s = ph['styles'][min(level, len(ph['styles']) - 1)]
            text = block['text']
            is_ai = text.startswith('✦ ')
            if is_ai:
                ai = True
                text = text[2:]
            marker = ''
            indent = 0
            lead = ''
            numbered = bool(block.get('numbered'))
            if block.get('marker'):
                indent = float(s.get('margin_left', 18))
                mx = float(s.get('indent', -18))
                if numbered:
                    indent = max(0, indent + mx)
                mark = escape(block['marker']) if block.get('numbered') else STAR if is_ai else escape(s.get('bullet', '•'))
                marker = f'<span class="marker" style="--marker-x:{mx:g}px">{mark}</span>'
                if block.get('numbered') and is_ai:
                    lead = '<span class="number-star">' + STAR + '</span>'
            elif is_ai:
                lead = STAR + ' '
            rendered_text = lead + inline(text)
            if numbered:
                rendered_text = '<span class="para-text">' + rendered_text + '</span>'
            out.append(f'<div class="para{" numbered" if numbered else ""}" role="{"listitem" if block.get("marker") else "paragraph"}" data-level="{level}" style="{style(s)}margin-left:{indent:g}px;--before:{float(s.get("before",0)):g}px;--after:{float(s.get("after",0)):g}px">{marker}{rendered_text}</div>')
        elif kind == 'code':
            lang = block.get('language', '')
            code = escape(block['text'])
            if lang and lang not in ('text', 'plain', 'plaintext'):
                try:
                    from pygments import highlight
                    from pygments.formatters import HtmlFormatter
                    from pygments.lexers import get_lexer_by_name
                    from pygments.util import ClassNotFound
                except ImportError:
                    raise ValueError('Syntax highlighting requires Pygments; install requirements.txt or use a plain/text fence')
                try:
                    lexer = get_lexer_by_name(lang, stripnl=False, ensurenl=False)
                except ClassNotFound:
                    raise ValueError('Unknown fenced code language: ' + lang)
                code = highlight(block['text'], lexer, HtmlFormatter(nowrap=True)).removesuffix('\n')
            out.append(f'<pre class="code-panel{" compact" if compact else ""}"><code data-language="{escape(lang)}">{code}</code></pre>')
        elif kind == 'table':
            rows = []
            for i, row in enumerate(block['rows']):
                tag = 'th' if i == 0 else 'td'
                rows.append('<tr>' + ''.join(f'<{tag}>' + inline(cell) + f'</{tag}>' for cell in row) + '</tr>')
            out.append('<div class="table-wrap"><table><thead>' + rows[0] + '</thead><tbody>' + ''.join(rows[1:]) + '</tbody></table></div>')
        elif kind == 'image':
            src = block['src']
            if urlsplit(src).scheme or src.startswith('//'):
                raise ValueError('Cache image locally before generation: ' + src)
            uri = data_uri(source_dir / unquote(src))
            out.append('<figure class="figure"><img alt="' + escape(block['alt']) + '" src="' + uri + '"></figure>')
        else:
            raise ValueError('Unsupported block: ' + kind)
    return ''.join(out), ai


def select_layout(page, theme):
    explicit = page.get('layout')
    if explicit:
        name = theme.get('aliases', {}).get(explicit, explicit)
    else:
        has_content = any(g['blocks'] or g.get('heading') for g in page['groups'])
        key = 'two-columns' if len(page['groups']) > 1 else 'content' if has_content else 'cover'
        name = theme.get('aliases', {}).get(key)
        if not name:
            raise ValueError('Theme requires a reviewed alias for ' + key)
    matches = [layout for layout in theme['layouts'] if layout['name'] == name]
    if len(matches) != 1:
        raise ValueError('Unknown or ambiguous layout: ' + str(explicit or name))
    return matches[0]


def generate(src, out, theme_path, compact=False, font_config=None, local_fonts=False):
    src, out, theme_path = Path(src).resolve(), Path(out).resolve(), Path(theme_path).resolve()
    theme = json.loads(theme_path.read_text())
    if not font_config and not local_fonts and theme.get('font_config'):
        font_config = theme_path.parent / theme['font_config']
    protected = {src, theme_path}
    if font_config:
        protected.add(Path(font_config).resolve())
    if out.suffix.lower() not in ('.html', '.htm'):
        raise ValueError('Output must have an .html or .htm extension')
    if out in protected or out.with_suffix('.manifest.json') in protected or out.with_suffix('.report.json') in protected:
        raise ValueError('Output and sidecars must differ from inputs')
    raw = src.read_bytes()
    pages = parse(raw.decode('utf-8'))
    protected.update((theme_path.parent / name).resolve() for name in theme.get('backgrounds', {}).values())
    for page in pages:
        for group in page['groups']:
            for block in group['blocks']:
                if block['kind'] == 'image' and not urlsplit(block['src']).scheme:
                    protected.add((src.parent / unquote(block['src'])).resolve())
    if font_config:
        protected.update((Path(font_config).resolve().parent / f['path']).resolve()
                         for f in json.loads(Path(font_config).read_text()) if f.get('path'))
    if {out, out.with_suffix('.manifest.json'), out.with_suffix('.report.json')} & protected:
        raise ValueError('Output/sidecars would overwrite a source asset')
    if float(theme['width']) <= 0 or float(theme['height']) <= 0:
        raise ValueError('Invalid theme dimensions')
    font_faces = json.loads(Path(font_config).read_text()) if font_config else theme.get('font_faces', [])
    if not font_faces:
        raise ValueError('Theme requires explicit regular/bold Latin/CJK font_faces')
    required_faces = {(family, weight) for family in ('DeckLatin', 'DeckCJK') for weight in (400, 700)}
    if not required_faces.issubset({(f['family'], f['weight']) for f in font_faces}):
        raise ValueError('Font mapping requires DeckLatin and DeckCJK, each with real 400 and 700 faces')
    font_provenance, coverage = [], {400: set(), 700: set()}
    font_text = raw.decode('utf-8') + 'AI-gen 0123456789'
    font_css = []
    for i, face in enumerate(font_faces):
        face = dict(face)
        if face.get('path'):
            if not font_config:
                raise ValueError('Embedded font paths require an explicit --font-config')
            font_path = Path(font_config).resolve().parent / face['path']
            face['source'], record, cmap = embed_font(font_path, font_text, face.get('index', 0))
            font_provenance.append({'family': face['family'], 'weight': face['weight'], **record})
            if face['weight'] in coverage:
                coverage[face['weight']].update(cmap)
        source = face.get('source') or ','.join('local(' + json.dumps(n) + ')' for n in face['local'])
        font_css.append('@font-face{font-family:' + json.dumps(face['family']) + ';font-style:normal;font-weight:' + str(int(face['weight'])) + ';src:' + source + ';}')
        face.pop('path', None)
        font_faces[i] = face
    if font_provenance:
        needed = {ord(c) for c in font_text if not c.isspace() and c != '✦'}
        for weight, available in coverage.items():
            if all(any(f['family'] == family and f['weight'] == weight for f in font_provenance) for family in ('DeckLatin', 'DeckCJK')):
                missing = needed - available
                if missing:
                    raise ValueError(f'Embedded {weight} fonts lack characters: ' + ''.join(chr(n) for n in sorted(missing)[:30]))
    slides, manifest_pages = [], []
    for page_no, page in enumerate(pages, 1):
        try:
            layout = select_layout(page, theme)
            titles = [p for p in layout['placeholders'] if p['role'] == 'title']
            bodies = [p for p in layout['placeholders'] if p['role'] in ('body', 'subtitle')]
            if len(titles) != 1:
                raise ValueError('Layout requires exactly one reviewed title region')
            groups = page['groups']
            has_content = any(g['blocks'] or g.get('heading') for g in groups)
            if has_content and len(bodies) != len(groups):
                raise ValueError(f'Layout has {len(bodies)} body regions for {len(groups)} groups; label all columns explicitly')
            bg = theme.get('backgrounds', {}).get(str(layout['index']))
            if not bg:
                raise ValueError('Missing reviewed background for layout ' + layout['name'])
            content = '<img class="background" alt="" src="' + data_uri(theme_path.parent / bg) + '">'
            content += placeholder(titles[0], '<div class="para">' + inline(page['title']) + '</div>', 'title')
            has_ai = False
            if has_content:
                for n, (group, ph) in enumerate(zip(groups, bodies), 1):
                    rendered, ai = render_blocks(group, ph, src.parent, compact)
                    content += placeholder(ph, rendered, f'body-{n}', any(b['kind'] == 'image' for b in group['blocks']))
                    has_ai = has_ai or ai
            if theme.get('page_number'):
                content += placeholder(theme['page_number'], f'<div class="para">{page_no}</div>', 'page-number')
            if has_ai and theme.get('personal_preferences', {}).get('ai_legend', True):
                content += '<div class="legend">' + STAR + ' AI-gen</div>'
            slides.append(f'<section class="slide" id="slide-{page_no}" aria-label="{escape(page["title"])}" style="width:{float(theme["width"]):g}px;height:{float(theme["height"]):g}px">' + content + '</section>')
            manifest_pages.append({'page': page_no, 'title': page['title'], 'layout': layout['name'], 'layout_index': layout['index'], 'ai_list_markers': has_ai})
        except (ValueError, KeyError) as exc:
            raise ValueError(f'Page {page_no}: {exc}') from exc
    config = {'width': theme['width'], 'height': theme['height'], 'font_faces': font_faces, 'embedded_fonts': bool(font_provenance)}
    config_json = json.dumps(config, ensure_ascii=False).replace('<', '\\u003c')
    css = (SKILL / 'assets/deck.css').read_text()
    css += '\n' + '\n'.join(font_css)
    css += '\n@page{size:' + str(theme['width']) + 'pt ' + str(theme['height']) + 'pt;margin:0;}\n@media print{.slide{zoom:1.3333333333333333;}}'
    css += '\n.code-panel .k,.code-panel .kn,.code-panel .kd,.code-panel .nb{color:#09678F}.code-panel .m,.code-panel .mi,.code-panel .mf{color:#8B4A24}.code-panel .o{color:#7A3E7A}.code-panel .c,.code-panel .c1,.code-panel .cm{color:#64748B}.code-panel .s,.code-panel .s1,.code-panel .s2{color:#4f6d4b}'
    controls = '<nav class="toolbar" aria-label="Presentation controls"><button id="prev" aria-label="Previous slide">←</button><span id="position" aria-live="polite"></span><button id="next" aria-label="Next slide">→</button><button id="overview">总览</button><button id="fullscreen">全屏</button></nav>'
    document = ('<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(pages[0]['title']) + '</title><style>' + css + '</style></head><body>' + '\n'.join(slides) + controls +
                '<script id="deck-config" type="application/json">' + config_json + '</script><script id="deck-qa" type="application/json">{}</script><script>' + (SKILL / 'assets/deck.js').read_text() + '</script></body></html>')
    digest = hashlib.sha256(document.encode()).hexdigest()
    manifest = {'source': str(src), 'source_sha256': hashlib.sha256(raw).hexdigest(), 'html_sha256': digest,
                'theme_sha256': hashlib.sha256(theme_path.read_bytes()).hexdigest(), 'template_source_sha256': theme.get('source_sha256'),
                'width': theme['width'], 'height': theme['height'], 'code_style': 'compact-16/19' if compact else 'default-20/24',
                'pages': manifest_pages, 'font_policy': 'subset embedded real source faces' if font_provenance else 'real installed local faces',
                'font_provenance': font_provenance,
                'source_preserved': True, 'pagination': 'explicit separators outside code fences'}
    report = {'html_sha256': digest, 'structural': 'passed', 'pages': len(pages), 'browser_layout': 'not_run', 'visual_review': 'not_performed'}
    out.parent.mkdir(parents=True, exist_ok=True)
    # Never publish a partially written HTML file.
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=out.parent, delete=False) as stream:
        stream.write(document)
        temp = Path(stream.name)
    temp.replace(out)
    out.with_suffix('.manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    out.with_suffix('.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('input')
    ap.add_argument('-o', '--output', required=True)
    ap.add_argument('--theme', required=True, help='Reviewed user-supplied theme.json; no presentation template is bundled')
    ap.add_argument('--font-config', help='JSON array of font_faces; paths are relative to this file. Supply only fonts approved for embedding.')
    ap.add_argument('--local-fonts', action='store_true', help='Use theme local font names instead of its embedded font configuration; font availability must be checked on each viewing machine')
    ap.add_argument('--compact-code', action='store_true', help='Deliberately use approved 16/19 code; body sizes stay fixed')
    a = ap.parse_args(argv)
    try:
        print(generate(a.input, a.output, a.theme, a.compact_code, a.font_config, a.local_fonts))
    except (ValueError, OSError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
