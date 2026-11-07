"""Behavior checks for source preservation and fail-closed HTML generation."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from complete import gaps, inventory, main as complete_main
from generate import SKILL, generate
from outline import parse


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.src = self.root / 'source.md'
        self.out = self.root / 'deck.html'
        # Build a disposable theme; tests must not distribute presentation assets
        # or depend on another installation's templates and fonts.
        self.theme = self.root / 'user-theme' / 'theme.json'
        self.theme.parent.mkdir()
        assets = self.theme.parent / 'artwork'
        assets.mkdir()
        (assets / 'blank.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"/>')
        title = {'id': 0, 'role': 'title', 'box': [32, 24, 736, 60],
                 'styles': [{'size': 28, 'bold': True}]}
        body_style = {'size': 20, 'leading': 1.2, 'margin_left': 18, 'indent': -18}
        body = {'id': 1, 'role': 'body', 'box': [32, 100, 736, 318], 'styles': [body_style]}
        left = {**body, 'box': [32, 100, 352, 318]}
        right = {**body, 'id': 2, 'box': [416, 100, 352, 318]}
        self.theme_data = {
            'width': 800, 'height': 450,
            'layouts': [
                {'index': 0, 'name': 'Title', 'placeholders': [title]},
                {'index': 1, 'name': 'Body', 'placeholders': [title, body]},
                {'index': 2, 'name': 'Columns', 'placeholders': [title, left, right]},
            ],
            'aliases': {'cover': 'Title', 'content': 'Body', 'two-columns': 'Columns'},
            'backgrounds': {str(i): 'artwork/blank.svg' for i in range(3)},
            # Structural tests do not load these faces. Browser QA must separately
            # use real fonts available on the validation machine.
            'font_faces': [{'family': family, 'weight': weight,
                            'local': ['Test Regular' if weight == 400 else 'Test Bold']}
                           for family in ('DeckLatin', 'DeckCJK') for weight in (400, 700)],
        }
        self.theme.write_text(json.dumps(self.theme_data))

    def write(self, text):
        self.src.write_text(text)
        return self.src

    def test_completion_protects_source_and_literal_code(self):
        text = '# 原文\r\n- [[whole]]\r\n- 用户 [[inline]] 保留\r\n---\r\n# 代码\r\n```text\r\n---\r\n[[literal]]\r\n```\r\n'
        self.src.write_bytes(text.encode())
        replacement = self.root / 'replacements.json'
        replacement.write_text(json.dumps({'1': '生成条目', '2': '新增'}))
        dest = self.root / 'completed.md'
        complete_main([str(self.src), '--replacements', str(replacement), '-o', str(dest)])
        result = dest.read_bytes().decode()
        self.assertEqual(self.src.read_bytes(), text.encode())
        self.assertIn('- ✦ {color:#000000}生成条目{/color}', result)
        self.assertIn('- 用户 {color:#000000}新增{/color} 保留', result)
        self.assertIn('[[literal]]', result)
        self.assertEqual(len(parse(result)), 2)
        self.assertEqual(len(inventory(text)), 2)

    def test_completion_cannot_add_pages(self):
        self.write('# A\n- [[gap]]')
        r = self.root / 'r.json'
        r.write_text(json.dumps({'1': 'new\n---\n# extra'}))
        with self.assertRaises(SystemExit):
            complete_main([str(self.src), '--replacements', str(r), '-o', str(self.root / 'new.md')])
        self.assertFalse((self.root / 'new.md').exists())

    def test_code_and_html_remain_literal(self):
        self.write('# Literal\n```html\n<script>alert(1)</script>\n---\n[[literal]]\n```')
        generate(self.src, self.out, self.theme)
        text = self.out.read_text()
        self.assertNotIn('<script>alert(1)</script>', text)
        self.assertIn('&lt;', text)
        self.assertEqual(len(json.loads(self.out.with_suffix('.manifest.json').read_text())['pages']), 1)

    def test_unknown_layout_or_image_preserves_existing_output(self):
        self.out.write_text('previous verified version')
        for text in ('# Test\n[HINT: nonexistent]', '# Test\n![missing](absent.png)', '# Test\n![remote](https://example.com/image.png)'):
            self.write(text)
            with self.assertRaises(ValueError):
                generate(self.src, self.out, self.theme)
            self.assertEqual(self.out.read_text(), 'previous verified version')

    def test_columns_keep_interleaved_code_in_the_column(self):
        pages = parse('# T\n[Column 1: Left]\n- A\n```text\nx\n```\n- B\n[Column 2: Right]\n3. C')
        self.assertEqual(len(pages[0]['groups']), 2)
        self.assertEqual([b['kind'] for b in pages[0]['groups'][0]['blocks']], ['paragraph', 'code', 'paragraph'])
        self.write('# T\n[Column 1: Left]\n- A\n[Column 2: Right]\n3. C')
        generate(self.src, self.out, self.theme)
        self.assertIn('>3.</span>', self.out.read_text())

    def test_bad_inputs_fail(self):
        for text in ('# A\n---\n', '# A\n| A | B |\n| C |', '# A\n**Visual:** smartart', '# A\n[Column 2: Wrong]\n- A', '# A\n```text\nno closing'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse(text)

    def test_source_cannot_be_output(self):
        self.write('# Source')
        before = self.src.read_bytes()
        with self.assertRaises(ValueError):
            generate(self.src, self.src, self.theme)
        self.assertEqual(self.src.read_bytes(), before)

    def test_manifest_tracks_current_source_and_html(self):
        self.write('# 标题\n- User\n  - Nested')
        generate(self.src, self.out, self.theme)
        m = json.loads(self.out.with_suffix('.manifest.json').read_text())
        self.assertEqual(m['html_sha256'], hashlib.sha256(self.out.read_bytes()).hexdigest())
        self.assertEqual(m['source_sha256'], hashlib.sha256(self.src.read_bytes()).hexdigest())
        self.assertIn('data-level="1"', self.out.read_text())

    def test_reused_completion_requires_unique_prompt(self):
        self.write('# T\n- [[repeat]]\n- [[repeat]]')
        prior = self.root / 'prior.json'
        prior.write_text(json.dumps({'replacements': [{'prompt': 'repeat', 'text': 'old'}]}))
        with self.assertRaises(SystemExit):
            complete_main([str(self.src), '--reuse', str(prior), '-o', str(self.root / 'new.md')])

    def test_inline_code_is_not_a_completion_gap(self):
        self.assertEqual([e['prompt'] for e in inventory('# T\n- `[[literal]]` and [[gap]]')], ['gap'])
        self.assertEqual(len(parse('# T\n- `[[literal]]`')), 1)

    def test_link_cannot_execute_javascript(self):
        self.write('# T\n- [unsafe](javascript:alert)')
        with self.assertRaises(ValueError):
            generate(self.src, self.out, self.theme)

    def test_incomplete_font_mapping_fails(self):
        self.write('# T')
        font_map = self.root / 'fonts.json'
        font_map.write_text(json.dumps([{'family': 'DeckLatin', 'weight': 400, 'local': ['Test Regular']}]))
        with self.assertRaises(ValueError):
            generate(self.src, self.out, self.theme, font_config=font_map)

    def test_cli_requires_explicit_theme(self):
        self.write('# Title')
        result = subprocess.run([sys.executable, str(SKILL / 'scripts/generate.py'),
                                 str(self.src), '-o', str(self.out)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('--theme', result.stderr)
        self.assertFalse(self.out.exists())

    def test_external_theme_works_from_an_unrelated_directory(self):
        self.write('# Title\n- Portable content')
        working = self.root / 'elsewhere'
        working.mkdir()
        result = subprocess.run([sys.executable, str(SKILL / 'scripts/generate.py'),
                                 str(self.src), '-o', str(self.out), '--theme', str(self.theme)],
                                cwd=working, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        document = self.out.read_text()
        self.assertIn('data:image/svg+xml;base64,', document)
        self.assertNotIn(str(self.theme.parent), document)
        self.assertIn('Portable content', document)

    def test_theme_font_config_resolves_relative_to_theme(self):
        self.write('# Title')
        font_dir = self.theme.parent / 'typography'
        font_dir.mkdir()
        (font_dir / 'fonts.json').write_text(json.dumps(self.theme_data.pop('font_faces')))
        self.theme_data['font_config'] = 'typography/fonts.json'
        self.theme.write_text(json.dumps(self.theme_data))
        generate(self.src, self.out, self.theme)
        self.assertIn('local(', self.out.read_text())

    def test_missing_background_preserves_existing_output(self):
        self.write('# Title')
        self.out.write_text('previous verified version')
        (self.theme.parent / 'artwork/blank.svg').unlink()
        with self.assertRaises(ValueError):
            generate(self.src, self.out, self.theme)
        self.assertEqual(self.out.read_text(), 'previous verified version')

    def test_local_font_opt_in_bypasses_theme_font_config(self):
        self.write('# Title')
        self.theme_data['font_config'] = 'unavailable-on-this-machine.json'
        self.theme.write_text(json.dumps(self.theme_data))
        generate(self.src, self.out, self.theme, local_fonts=True)
        manifest = json.loads(self.out.with_suffix('.manifest.json').read_text())
        self.assertEqual(manifest['font_provenance'], [])
        self.assertEqual(manifest['font_policy'], 'real installed local faces')


if __name__ == '__main__':
    unittest.main()
