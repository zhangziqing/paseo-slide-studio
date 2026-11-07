"""The common slide-outline dialect: explicit pages and literal fenced code."""
import re


def split_pages(text):
    pages, lines, fence = [], [], None
    for line in text.splitlines():
        match = re.match(r'^\s*(`{3,}|~{3,})(.*)$', line)
        if match:
            token, suffix = match.groups()
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence) and not suffix.strip():
                fence = None
        if fence is None and re.fullmatch(r'\s*---\s*', line):
            pages.append(lines)
            lines = []
        else:
            lines.append(line)
    pages.append(lines)
    if fence:
        raise ValueError('Unclosed code fence')
    return pages


def parse(text):
    result = []
    for page_no, lines in enumerate(split_pages(text), 1):
        if not any(line.strip() for line in lines):
            raise ValueError(f'Page {page_no}: empty page; preserve source and review its boundary')
        page = {'title': '', 'layout': None, 'groups': [{'heading': None, 'blocks': []}]}
        blocks = page['groups'][0]['blocks']
        fence, code, language, indents = None, [], '', [0]
        for line in lines:
            fm = re.match(r'^\s*(`{3,}|~{3,})(.*)$', line)
            if fm:
                token, suffix = fm.groups()
                if fence is None:
                    fence, code, language = token, [], suffix.strip()
                elif token[0] == fence[0] and len(token) >= len(fence) and not suffix.strip():
                    blocks.append({'kind': 'code', 'text': '\n'.join(code), 'language': language})
                    fence = None
                else:
                    code.append(line)
                continue
            if fence:
                code.append(line)
                continue
            if not line.strip():
                continue
            if '[[' in re.sub(r'(`+).*?\1', '', line):
                raise ValueError(f'Page {page_no}: unresolved [[gap]]')
            m = re.fullmatch(r'\s*(?:\[HINT:\s*(.*?)\]|\*\*Layout:\s*(.*?)\*\*|\*\*Layout:\*\*\s*(.*))\s*', line)
            if m:
                if page['layout']:
                    raise ValueError(f'Page {page_no}: duplicate layout hint')
                page['layout'] = next(x for x in m.groups() if x is not None)
                continue
            if re.match(r'^\s*\*\*Visual:', line):
                raise ValueError(f'Page {page_no}: Visual markers need an explicitly authored HTML composition')
            m = re.match(r'^#{1,6}\s+(.*)$', line)
            if m:
                if not page['title']:
                    page['title'] = m.group(1)
                else:
                    blocks.append({'kind': 'paragraph', 'text': '**' + m.group(1) + '**', 'level': 0})
                continue
            m = re.fullmatch(r'\s*\[(Column|Card)\s+(\d+):\s*(.*?)\]\s*', line)
            if m:
                n = int(m.group(2))
                if len(page['groups']) == 1 and not blocks and page['groups'][0]['heading'] is None:
                    page['groups'] = []
                if n != len(page['groups']) + 1:
                    raise ValueError(f'Page {page_no}: column labels must start at 1 and be consecutive; no preamble')
                group = {'heading': m.group(3), 'blocks': []}
                page['groups'].append(group)
                blocks, indents = group['blocks'], [0]
                continue
            m = re.fullmatch(r'\s*!\[([^\]]*)\]\((.+)\)\s*', line)
            if m:
                blocks.append({'kind': 'image', 'alt': m.group(1), 'src': m.group(2)})
                continue
            if line.strip().startswith('|'):
                if re.fullmatch(r'[| :\-]+', line.strip()):
                    continue
                row = [x.strip().replace('\x00', '|') for x in line.strip().strip('|').replace('\\|', '\x00').split('|')]
                if not blocks or blocks[-1]['kind'] != 'table':
                    blocks.append({'kind': 'table', 'rows': []})
                blocks[-1]['rows'].append(row)
                continue
            m = re.match(r'^(\s*)([-*+] |\d+[.)] )(.*)$', line)
            if m:
                indent = len(m.group(1).expandtabs(4))
                if indent > indents[-1]:
                    indents.append(indent)
                while indent < indents[-1]:
                    indents.pop()
                if indent != indents[-1] or len(indents) > 9:
                    raise ValueError(f'Page {page_no}: inconsistent or excessive list indentation')
                blocks.append({'kind': 'paragraph', 'text': m.group(3), 'level': len(indents) - 1,
                               'marker': m.group(2).strip(), 'numbered': m.group(2)[0].isdigit()})
            else:
                blocks.append({'kind': 'paragraph', 'text': line, 'level': 0})
        if not page['title']:
            raise ValueError(f'Page {page_no}: a Markdown heading is required')
        for group in page['groups']:
            for block in group['blocks']:
                if block['kind'] == 'table' and len({len(r) for r in block['rows']}) != 1:
                    raise ValueError(f'Page {page_no}: ragged table')
        result.append(page)
    return result
