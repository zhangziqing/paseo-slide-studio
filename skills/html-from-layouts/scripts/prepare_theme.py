#!/usr/bin/env python3
"""Convert a reviewed PowerPoint background PDF into ordered vector HTML assets."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('theme')
    ap.add_argument('--background-pdf', required=True)
    args = ap.parse_args()
    try:
        import pymupdf as fitz
    except ImportError:
        ap.error('PDF background conversion requires PyMuPDF from requirements.txt')
    path = Path(args.theme).resolve()
    pdf = Path(args.background_pdf).resolve()
    theme = json.loads(path.read_text())
    doc = fitz.open(pdf)
    if len(doc) != len(theme['layouts']):
        ap.error('PDF page count must equal layout count in the same order')
    outputs = []
    for layout, page in zip(theme['layouts'], doc):
        if abs(page.rect.width - theme['width']) > .1 or abs(page.rect.height - theme['height']) > .1:
            ap.error('Background PDF dimensions differ from template')
        out = path.parent / f'layout-{layout["index"]}.svg'
        if out.exists() or out in (path, pdf):
            ap.error('Refusing to overwrite background asset: ' + str(out))
        outputs.append((layout['index'], out, page.get_svg_image(text_as_path=True)))
    theme['backgrounds'] = {}
    for index, out, data in outputs:
        out.write_text(data)
        theme['backgrounds'][str(index)] = out.name
    theme['html_provenance'] = {'background_pdf_sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(),
                                 'background_conversion': 'PyMuPDF SVG with decorative text outlined'}
    path.write_text(json.dumps(theme, ensure_ascii=False, indent=2))
    print(path)


if __name__ == '__main__':
    main()
