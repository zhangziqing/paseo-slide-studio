"""Subset explicitly supplied fonts; keep proprietary binaries out of the skill."""
import base64
import hashlib
import io
from pathlib import Path


def embed_font(path, text, index=0):
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        raise ValueError('Font subsetting requires fonttools from requirements.txt')
    path = Path(path)
    if not path.is_file():
        raise ValueError('Required source font not found: ' + str(path) + '; supply a reviewed --font-config or explicitly choose --local-fonts')
    if path.suffix.lower() not in ('.ttf', '.ttc', '.otf', '.woff', '.woff2'):
        raise ValueError('Unsupported font format: ' + str(path))
    raw = path.read_bytes()
    font = TTFont(io.BytesIO(raw), fontNumber=int(index))
    present = set(font.getBestCmap() or {})
    version = font['name'].getDebugName(5)
    options = subset.Options()
    options.layout_features = ['*']
    options.drop_tables += ['meta', 'MERG', 'feat', 'morx']
    worker = subset.Subsetter(options=options)
    worker.populate(text=text)
    worker.subset(font)
    font.flavor = 'woff'
    stream = io.BytesIO()
    font.save(stream)
    data = stream.getvalue()
    return ('url("data:font/woff;base64,' + base64.b64encode(data).decode('ascii') + '")',
            {'source_sha256': hashlib.sha256(raw).hexdigest(), 'source_filename': path.name,
             'collection_index': int(index), 'version': version, 'subset_sha256': hashlib.sha256(data).hexdigest(),
             'subset_bytes': len(data)}, present)
