"""Independent MuPDF check of the optional bangla-pdf probe.

Run `node scripts/evaluate-bengali-pdf.mjs /tmp/land-bangla-probe.pdf`,
then run this script with that PDF as its sole argument. Exit nonzero on
any mismatch; individual line checks do not ignore duplicates or spacing.
"""
import json
import sys
import pymupdf

cases = ['ভূমি জরিপের সারসংক্ষেপ', 'প্রকল্প: জমি Field', 'ক্ষেত্রফল ও দৈর্ঘ্য',
         'নির্মাণ এবং ক্ষ্ম', 'আমার সোনার বাংলা', 'অসংখ্য ক্ষুদ্র স্থাপত্য', '২৩.৮, ৯০.৪']
doc = pymupdf.open(sys.argv[1])
page = doc[0]
lines = page.get_text().splitlines()
font_info = {font[3]: len(doc.extract_font(font[0])[3]) for font in page.get_fonts()}
result = {'lines': lines, 'matches_as_exact_line': {case: case in lines for case in cases},
          'lines_exactly_equal_corpus': lines == cases, 'fonts': font_info,
          'images': len(page.get_images())}
print(json.dumps(result, ensure_ascii=False, indent=2))
ok = lines == cases and bool(font_info) and all(size > 0 for size in font_info.values()) and not page.get_images()
doc.close()
if not ok:
    sys.exit(1)
