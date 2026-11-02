#!/usr/bin/env python3
"""Remove the hidden template placeholder "xx" from page 1 of the ESC VEU Statement of rights.

Usage: python3 scripts/clean-statement-of-rights.py [in.pdf] [out.pdf]
Defaults: docs/esc-forms/veu-statement-of-rights.pdf -> docs/esc-forms/veu-statement-of-rights-clean.pdf

Removes only the text-show operation(s) on page 1 that draw exactly "xx" at the known
placeholder position (Tm x~63.38, y~638.86, font /F4). Anything else matching, or no match,
exits non-zero and writes nothing. The original file is never modified.
"""
import os
import sys
import tempfile

import pikepdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "docs/esc-forms/veu-statement-of-rights.pdf")
dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "docs/esc-forms/veu-statement-of-rights-clean.pdf")
POS = (63.384, 638.86)
FONT = "/F4"


def fail(msg):
    print(f"REFUSED: {msg}", file=sys.stderr)
    sys.exit(1)


def shown_text(operands):
    parts = []
    for item in operands[0]:
        if isinstance(item, pikepdf.String):
            parts.append(bytes(item).decode("latin1"))
    return "".join(parts)


pdf = pikepdf.open(src)
if len(pdf.pages) != 2:
    fail(f"expected 2 pages, found {len(pdf.pages)}")
page = pdf.pages[0]
ops = list(pikepdf.parse_content_stream(page))
keep, removed = [], []
tm, font = None, None
for operands, op in ops:
    name = str(op)
    if name == "Tm":
        tm = [float(x) for x in operands]
    elif name == "Tf":
        font = str(operands[0])
    drop = False
    if name in ("TJ", "Tj"):
        text = shown_text([pikepdf.Array([operands[0]])] if name == "Tj" else operands)
        at_pos = tm and abs(tm[4] - POS[0]) < 0.01 and abs(tm[5] - POS[1]) < 0.01 and font == FONT
        if at_pos:
            if text != "xx":
                fail(f"text shown at the placeholder position is {text!r}, not 'xx'")
            drop = True
        elif text.strip() == "xx":
            fail("another 'xx' text-show exists away from the placeholder position")
    (removed if drop else keep).append((operands, op))
if len(removed) != 1:
    fail(f"expected to remove exactly 1 'xx' text-show, found {len(removed)}")

page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(keep))
fd, tmp = tempfile.mkstemp(suffix=".pdf", dir=os.path.dirname(os.path.abspath(dst)))
os.close(fd)
try:
    pdf.save(tmp, deterministic_id=True)
    os.replace(tmp, dst)
except BaseException:
    if os.path.exists(tmp):
        os.unlink(tmp)
    raise
print(f"removed 1 text-show 'xx' from page 1; wrote {dst}")
