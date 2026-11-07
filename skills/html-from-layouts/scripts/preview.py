#!/usr/bin/env python3
"""Real Chromium layout checks, page screenshots and optional slide PDF export."""
import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def find_browser(explicit=None):
    candidates = [explicit, os.environ.get('CHROME_BIN'), shutil.which('google-chrome'), shutil.which('chromium'),
                  shutil.which('chromium-browser'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    return next((str(Path(c).resolve()) for c in candidates if c and Path(c).is_file()), None)


def chrome(browser, url, options, timeout):
    with tempfile.TemporaryDirectory(prefix='html-deck-chrome-') as profile:
        command = [browser, '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                   '--disable-background-networking', '--hide-scrollbars', '--force-device-scale-factor=1',
                   '--user-data-dir=' + profile, '--virtual-time-budget=5000', '--timeout=15000'] + options + [url]
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError(f'Chromium exited {result.returncode}: {result.stderr[-2000:]}')
        return result.stdout


def preview(path, output, browser=None, screenshots=True, pdf=False, timeout=30):
    path, output = Path(path).resolve(), Path(output).resolve()
    report_path = path.with_suffix('.report.json')
    manifest_path = path.with_suffix('.manifest.json')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    # An edited file invalidates prior structure/preview results.
    old_report = json.loads(report_path.read_text()) if report_path.exists() else {}
    report = old_report if old_report.get('html_sha256') == digest else {'structural': 'not_run_for_current_html'}
    report.update({'html_sha256': digest, 'browser_layout': 'not_run', 'visual_review': 'not_performed', 'screenshots': [], 'pdf': None})
    report.pop('error', None)
    report.pop('browser', None)
    report.pop('preview_export', None)
    output.mkdir(parents=True, exist_ok=True)
    browser = find_browser(browser)
    try:
        if not browser:
            raise RuntimeError('No Chromium browser available; install Chrome/Chromium or set CHROME_BIN')
        dom = chrome(browser, path.as_uri() + '?capture=1', ['--dump-dom', '--window-size=1280,800'], timeout)
        m = re.search(r'<script\b(?=[^>]*\bid="deck-qa")(?=[^>]*\bdata-ready="true")[^>]*>(.*?)</script>', dom, re.S)
        if not m:
            raise RuntimeError('Browser did not finish deckReady; no valid layout result')
        qa = json.loads(m.group(1))
        report['browser_layout'] = qa['status']
        report['browser'] = qa
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text())
            report['manifest_matches_html'] = manifest.get('html_sha256') == digest
            if report['manifest_matches_html'] and len(manifest['pages']) != qa['pages']:
                raise RuntimeError('Browser page count differs from generation manifest')
            width, height = manifest['width'], manifest['height']
        else:
            raise RuntimeError('Missing generation manifest; restore or review it before automated preview')
        report['pages'] = qa['pages']
        if qa['status'] != 'passed':
            raise ValueError('Browser layout failed; see page-specific issues in report')
        if screenshots:
            for n in range(1, qa['pages'] + 1):
                # Temporary output avoids accidentally serving old screenshots after failure.
                dest = output / f'page-{n:03d}.png'
                with tempfile.TemporaryDirectory(prefix='html-deck-capture-') as temp:
                    png = Path(temp) / 'capture.png'
                    chrome(browser, path.as_uri() + f'?capture=1#{n}',
                           [f'--window-size={round(width)},{round(height)}', '--screenshot=' + str(png)], timeout)
                    if not png.is_file() or not png.stat().st_size:
                        raise RuntimeError(f'Page {n}: screenshot not produced')
                    shutil.copyfile(png, dest)
                report['screenshots'].append(str(dest))
        if pdf:
            dest = output / 'slides.pdf'
            with tempfile.TemporaryDirectory(prefix='html-deck-print-') as temp:
                pdf_path = Path(temp) / 'slides.pdf'
                chrome(browser, path.as_uri() + '?capture=1', ['--print-to-pdf=' + str(pdf_path), '--no-pdf-header-footer'], timeout)
                if not pdf_path.is_file() or not pdf_path.stat().st_size:
                    raise RuntimeError('PDF export did not produce a file')
                report['pdf_geometry'] = 'not_checked; install PyMuPDF to verify PDF page count and dimensions'
                try:
                    import pymupdf as fitz
                except ImportError:
                    pass
                else:
                    doc = fitz.open(pdf_path)
                    if len(doc) != qa['pages'] or any(abs(p.rect.width - width) > .1 or abs(p.rect.height - height) > .1 for p in doc):
                        raise RuntimeError('PDF page count or dimensions differ from template')
                    report['pdf_geometry'] = 'passed'
                shutil.copyfile(pdf_path, dest)
            report['pdf'] = str(dest)
        report['preview_export'] = 'passed'
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        report['preview_export'] = 'failed'
        if report.get('browser_layout') == 'not_run':
            report['browser_layout'] = 'unavailable'
        report['error'] = str(exc)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
        raise RuntimeError(str(exc)) from exc
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('html')
    ap.add_argument('-o', '--output', required=True)
    ap.add_argument('--browser')
    ap.add_argument('--check-only', action='store_true')
    ap.add_argument('--pdf', action='store_true')
    ap.add_argument('--timeout', type=int, default=30, help='Maximum seconds per browser process')
    a = ap.parse_args(argv)
    try:
        result = preview(a.html, a.output, a.browser, not a.check_only, a.pdf, a.timeout)
        print(json.dumps({'browser_layout': result['browser_layout'], 'pages': result['pages'], 'visual_review': result['visual_review']}, ensure_ascii=False))
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
