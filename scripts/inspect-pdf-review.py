"""Independent MuPDF review of generate-pdf-review.mjs output.

Research-only optional dependency: PyMuPDF 2.0 (not a runtime dependency).
Usage: python scripts/inspect-pdf-review.py /tmp/land-pdf-review en
       python scripts/inspect-pdf-review.py /tmp/land-pdf-review bn
Exits nonzero on a failed check, including logical text extraction.
"""
import json
import re
import sys
from pathlib import Path
import pymupdf

folder, language = Path(sys.argv[1]), sys.argv[2]
if language not in ('en', 'bn'):
    raise ValueError('Language must be en or bn')
file = folder / f'{language}.pdf'
doc = pymupdf.open(file)
texts = []
fonts = {}
clipped_spans = []
image_count = 0
vector_paths = 0
for number, page in enumerate(doc, 1):
    texts.append(page.get_text())
    image_count += len(page.get_images())
    vector_paths += len(page.get_drawings())
    for font in page.get_fonts():
        xref, _, _, name, *_ = font
        fonts[name] = len(doc.extract_font(xref)[3])
    for block in page.get_text('dict')['blocks']:
        if 'lines' not in block:
            continue
        for line in block['lines']:
            for span in line['spans']:
                box = pymupdf.Rect(span['bbox'])
                if not page.rect.contains(box):
                    clipped_spans.append({'page': number, 'text': span['text'], 'box': tuple(box)})
    page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(str(folder / f'{language}-page-{number}.png'))

text = '\n'.join(texts)
if language == 'en':
    checks = {'title': 'Land survey summary' in text, 'name': 'Field copy' in text, 'disclaimer': 'spherical estimates' in text}
    pattern = r'(?m)^23, (90(?:\.\d+)?)$'
    expected = [str(round(90 + i / 1000, 3)).removesuffix('.0') for i in range(150)]
else:
    checks = {'title': 'ভূমি জরিপের সারসংক্ষেপ' in text, 'name': 'জমি Field' in text,
              'reference': 'স্থানাঙ্ক: WGS84 দ্রাঘিমাংশ / অক্ষাংশ' in text}
    pattern = r'(?m)^২৩, (৯০(?:\.[০-৯]+)?)$'
    translation = str.maketrans('0123456789', '০১২৩৪৫৬৭৮৯')
    expected = [str(round(90 + i / 1000, 3)).removesuffix('.0').translate(translation) for i in range(150)]
found = re.findall(pattern, text)
checks.update({'multipage': len(doc) > 1, 'all_150_coordinates_in_order': found == expected,
               'embedded_font': bool(fonts) and all(size > 0 for size in fonts.values()),
               'vector_paths_present': vector_paths > 0, 'no_raster_images': image_count == 0,
               'text_boxes_inside_page': len(clipped_spans) == 0})
print(json.dumps({'file': str(file), 'pages': len(doc), 'fonts': fonts, 'images': image_count,
                  'vector_paths': vector_paths, 'coordinates_found': len(found),
                  'clipped_spans': clipped_spans, 'checks': checks}, ensure_ascii=False, indent=2))
doc.close()
if not all(checks.values()):
    sys.exit(1)
