"""A student's pages, made ready to mark, and the grader's marks drawn on them.

  python -E -P scripts/grading/pages.py prepare grading-inbox/<id>
      scans/NN.* -> pages/NN.jpg (upright, PDFs split into pages, long side at
      most MAX_SIDE) + grid/NN.jpg (the same page under a labelled 0-100 grid to
      read mark positions off) + pages/pages.json.
  python -E -P scripts/grading/pages.py draw grading-inbox/<id>
      preview/marks.json (written by grading:preview) -> preview/NN.jpg.

Mark positions are percentages of the PREPARED page, so the grid, the drawing
and the app all agree whatever the photo's size or rotation tag. Run with
-E -P, not -I: isolated mode hides PyMuPDF on this machine (see GRADING.md).
"""
import json
import re
import sys
import textwrap
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFont, ImageOps

MAX_SIDE = 2000
PDF_DPI = 150
JPEG_QUALITY = 85
RED = (211, 47, 47)
GRID_MINOR = (0, 150, 255, 70)
GRID_MAJOR = (0, 110, 230, 150)
HAND_IN = re.compile(r'^\d{2}\.(jpg|jpeg|png|webp|pdf)$', re.IGNORECASE)


def fail(msg):
    print(f'Error: {msg}', file=sys.stderr)
    raise SystemExit(1)


def font(px):
    return ImageFont.load_default(size=max(10, int(px)))


def shrink(img):
    w, h = img.size
    scale = MAX_SIDE / max(w, h)
    if scale < 1:
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    return img


def source_images(path):
    """Yield (source label, PIL image) for one hand-in file."""
    if path.suffix.lower() == '.pdf':
        with fitz.open(path) as doc:
            for i, page in enumerate(doc, start=1):
                pix = page.get_pixmap(dpi=PDF_DPI)
                yield f'scans/{path.name}#{i}', Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    else:
        with Image.open(path) as img:
            yield f'scans/{path.name}', ImageOps.exif_transpose(img).convert('RGB')


def grid_copy(img):
    w, h = img.size
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f = font(min(w, h) * 0.022)
    for pct in range(5, 100, 5):
        major = pct % 10 == 0
        colour = GRID_MAJOR if major else GRID_MINOR
        width = 2 if major else 1
        x, y = w * pct / 100, h * pct / 100
        d.line([(x, 0), (x, h)], fill=colour, width=width)
        d.line([(0, y), (w, y)], fill=colour, width=width)
        if major:
            label = str(pct)
            for anchor, pos in (('mt', (x, 2)), ('mb', (x, h - 2)), ('lm', (2, y)), ('rm', (w - 2, y))):
                d.text(pos, label, fill=(0, 70, 200, 255), font=f, anchor=anchor,
                       stroke_width=3, stroke_fill=(255, 255, 255, 230))
    return Image.alpha_composite(img.convert('RGBA'), layer).convert('RGB')


def prepare(inbox):
    inbox = Path(inbox)
    files = sorted(p for p in (inbox / 'scans').glob('*') if HAND_IN.match(p.name))
    if not files:
        fail(f'no hand-in files in {inbox / "scans"}')
    (inbox / 'pages').mkdir(exist_ok=True)
    (inbox / 'grid').mkdir(exist_ok=True)
    info = []
    for f in files:
        for source, img in source_images(f):
            img = shrink(img)
            n = len(info) + 1
            name = f'{n:02d}.jpg'
            img.save(inbox / 'pages' / name, quality=JPEG_QUALITY)
            grid_copy(img).save(inbox / 'grid' / name, quality=JPEG_QUALITY)
            info.append({'page': n, 'source': source, 'width': img.width, 'height': img.height})
    (inbox / 'pages' / 'pages.json').write_text(json.dumps(info, indent=2) + '\n', encoding='utf-8')
    return info


# ── Drawing ────────────────────────────────────────────────────────────────

def wrap_note(draw, text, f, max_w):
    """Greedy word wrap to max_w pixels."""
    avg = max(1, draw.textlength('abcdefghij', font=f) / 10)
    for width in range(max(8, int(max_w / avg)), 4, -1):
        lines = textwrap.wrap(text, width=width) or ['']
        if all(draw.textlength(line, font=f) <= max_w for line in lines):
            return lines
    return textwrap.wrap(text, width=4)


def draw_mark(d, m, w, h):
    unit = w * 0.03                       # size of a tick/cross, by page width
    pen = max(3, round(w * 0.004))
    x, y = w * m['x'] / 100, h * m['y'] / 100
    kind = m['kind']
    if kind == 'tick':
        d.line([(x - unit * 0.5, y), (x - unit * 0.1, y + unit * 0.45), (x + unit * 0.6, y - unit * 0.55)],
               fill=RED, width=pen, joint='curve')
    elif kind == 'cross':
        r = unit * 0.45
        d.line([(x - r, y - r), (x + r, y + r)], fill=RED, width=pen)
        d.line([(x - r, y + r), (x + r, y - r)], fill=RED, width=pen)
    elif kind == 'circle':
        rx, ry = w * m['w'] / 200, h * m['h'] / 200
        d.ellipse([x - rx, y - ry, x + rx, y + ry], outline=RED, width=pen)
    elif kind == 'score':
        f = font(w * 0.032)
        text = m['text']
        l, t, r, b = d.textbbox((x, y), text, font=f, anchor='mm')
        pad = w * 0.012
        d.ellipse([l - pad * 1.6, t - pad, r + pad * 1.6, b + pad], outline=RED, width=pen)
        d.text((x, y), text, fill=RED, font=f, anchor='mm')
    elif kind == 'note':
        f = font(w * 0.024)
        margin = w * 0.02
        max_w = max(w * 0.3, w - x - margin)
        lines = wrap_note(d, m['text'], f, min(max_w, w - 2 * margin))
        line_h = f.size * 1.25
        block_w = max(d.textlength(line, font=f) for line in lines)
        block_h = line_h * len(lines)
        left = min(x, w - margin - block_w)      # pull left rather than run off the page
        top = min(max(y - block_h / 2, margin), h - margin - block_h)
        if m.get('toX') is not None:
            tx, ty = w * m['toX'] / 100, h * m['toY'] / 100
            sx = left if tx < left else left + block_w if tx > left + block_w else tx
            sy = top + block_h / 2
            d.line([(sx, sy), (tx, ty)], fill=RED, width=max(2, pen - 1))
            dot = pen * 1.2
            d.ellipse([tx - dot, ty - dot, tx + dot, ty + dot], fill=RED)
        for i, line in enumerate(lines):
            d.text((left, top + i * line_h), line, fill=RED, font=f,
                   stroke_width=max(2, pen - 1), stroke_fill=(255, 255, 255))
    else:
        fail(f'unknown mark kind {kind!r}')


def draw(inbox):
    inbox = Path(inbox)
    payload = json.loads((inbox / 'preview' / 'marks.json').read_text(encoding='utf-8'))
    count = payload['pageCount']
    missing = [n for n in range(1, count + 1) if not (inbox / 'pages' / f'{n:02d}.jpg').exists()]
    if missing:
        fail(f'pages {missing} were not prepared; run grading:pull again')
    out = []
    for n in range(1, count + 1):
        with Image.open(inbox / 'pages' / f'{n:02d}.jpg') as src:
            img = src.convert('RGB')
        d = ImageDraw.Draw(img)
        for m in payload['marks']:
            if m['page'] == n:
                draw_mark(d, m, img.width, img.height)
        name = inbox / 'preview' / f'{n:02d}.jpg'
        img.save(name, quality=JPEG_QUALITY)
        out.append(str(name))
    return out


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('prepare', 'draw'):
        fail('usage: pages.py prepare|draw <inbox folder>')
    result = prepare(sys.argv[2]) if sys.argv[1] == 'prepare' else draw(sys.argv[2])
    print(json.dumps(result))
