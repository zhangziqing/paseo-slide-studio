"""Extract user templates without bundled assets or personal font defaults."""
import hashlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from lxml import etree
from pptx import Presentation


class ProfileTests(unittest.TestCase):
    def test_user_pptx_and_potx_with_inherited_page_number_style(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stream = io.BytesIO()
            presentation = Presentation()
            presentation.save(stream)
            ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
                  'p': 'http://schemas.openxmlformats.org/presentationml/2006/main'}
            for extension in ('pptx', 'potx'):
                with self.subTest(extension=extension):
                    source = root / ('user.' + extension)
                    with zipfile.ZipFile(stream) as original, zipfile.ZipFile(source, 'w') as custom:
                        for name in original.namelist():
                            data = original.read(name)
                            if name == 'ppt/theme/theme1.xml':
                                theme = etree.fromstring(data)
                                theme.find('a:themeElements/a:fontScheme/a:minorFont/a:latin', ns).set('typeface', 'Example Sans')
                                data = etree.tostring(theme)
                            if name == 'ppt/slideMasters/slideMaster1.xml':
                                master = etree.fromstring(data)
                                master.find('p:txStyles/p:otherStyle/a:lvl1pPr/a:defRPr', ns).set('sz', '1750')
                                data = etree.tostring(master)
                            if name == '[Content_Types].xml' and extension == 'potx':
                                data = data.replace(b'presentationml.presentation.main+xml', b'presentationml.template.main+xml')
                            custom.writestr(name, data)
                    before = source.read_bytes()
                    output = root / extension
                    result = subprocess.run([sys.executable, str(Path(__file__).with_name('profile.py')),
                                             str(source), '-o', str(output)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(source.read_bytes(), before)
                    profile = json.loads((output / 'theme.json').read_text())
                    self.assertEqual(profile['source_sha256'], hashlib.sha256(before).hexdigest())
                    self.assertEqual(profile['page_number']['styles'][0]['latin'], 'Example Sans')
                    self.assertEqual(profile['page_number']['styles'][0]['size'], 17.5)
                    self.assertEqual(profile['aliases'], {})
                    self.assertEqual(profile['font_faces'], [])
                    for name in ('background.pptx', 'specimen.pptx'):
                        self.assertEqual(len(Presentation(output / name).slides), len(presentation.slide_layouts))


if __name__ == '__main__':
    unittest.main()
