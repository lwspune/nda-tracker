"""Render each page of a PDF to PNG beside it: <name>-p01.png, <name>-p02.png, ...
Usage: python -E -P scripts/grading/pdf2png.py <file.pdf> [dpi]"""
import sys
from pathlib import Path

import fitz  # PyMuPDF

src = Path(sys.argv[1])
dpi = int(sys.argv[2]) if len(sys.argv) > 2 else 150
with fitz.open(src) as doc:
    for i, page in enumerate(doc, start=1):
        out = src.with_name(f"{src.stem}-p{i:02d}.png")
        page.get_pixmap(dpi=dpi).save(out)
        print(out.name)
