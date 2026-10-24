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
import html
import io
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
    # PIL's built-in font has no Greek, minus sign or ≠, so "Δu ≠ 0" in a note
    # printed as empty boxes on the student's page. PIL cannot fall back from one
    # font to another per character, so use Segoe UI Symbol: the same Latin as
    # the report's Segoe UI, plus ⇒ and ∈, which Segoe UI itself lacks.
    size = max(10, int(px))
    for name in ('seguisym.ttf', 'segoeui.ttf'):
        if (FONT_DIR / name).exists():
            return ImageFont.truetype(str(FONT_DIR / name), size)
    return ImageFont.load_default(size=size)


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


def rotate(inbox, page, direction='left'):
    """Turn one prepared page a quarter-turn and move its marks with it.

    prepare() turns a photo upright only when it carries a rotation tag; a
    phone photo without one stays sideways. Run this before marking that page
    (or after: the marks in grade.json are moved too). Then preview again."""
    inbox = Path(inbox)
    if not inbox.is_dir():
        inbox = Path('grading-inbox') / inbox.name
    if direction not in ('left', 'right'):
        fail(f'direction must be left or right, not {direction!r}')
    n = int(page)
    name = f'{n:02d}.jpg'
    if not (inbox / 'pages' / name).exists():
        fail(f'no page {n} in {inbox / "pages"}')

    with Image.open(inbox / 'pages' / name) as src:
        img = src.convert('RGB').rotate(90 if direction == 'left' else -90, expand=True)
    img.save(inbox / 'pages' / name, quality=JPEG_QUALITY)
    (inbox / 'grid').mkdir(exist_ok=True)
    grid_copy(img).save(inbox / 'grid' / name, quality=JPEG_QUALITY)

    meta_path = inbox / 'pages' / 'pages.json'
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    for entry in meta:
        if entry['page'] == n:
            entry['width'], entry['height'] = img.size
    meta_path.write_text(json.dumps(meta, indent=2) + '\n', encoding='utf-8')

    # Turning left, the right edge becomes the top: (x, y) -> (y, 100 - x).
    def turn(x, y):
        return (y, 100 - x) if direction == 'left' else (100 - y, x)

    grade_path = inbox / 'grade.json'
    moved = 0
    if grade_path.exists():
        grade = json.loads(grade_path.read_text(encoding='utf-8'))
        for m in grade.get('marks', []):
            if m.get('page') != n:
                continue
            m['x'], m['y'] = (round(v, 2) for v in turn(m['x'], m['y']))
            if 'w' in m and 'h' in m:
                m['w'], m['h'] = m['h'], m['w']
            if m.get('to'):
                m['to'] = dict(zip(('x', 'y'), (round(v, 2) for v in turn(m['to']['x'], m['to']['y']))))
            moved += 1
        grade_path.write_text(json.dumps(grade, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return {'page': n, 'width': img.width, 'height': img.height, 'marksMoved': moved}


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


# ── The report PDF ─────────────────────────────────────────────────────────
# Summary page(s) laid out from preview/report.json (every number in it comes
# from buildPaperReport in src/lib/assignments/paperReport.js, the same builder
# the app uses), then the marked pages exactly as previewed.

FONT_DIR = Path('C:/Windows/Fonts')
PDF_PAGE_SIDE = 1400        # marked pages are shrunk for the PDF ...
PDF_JPEG_QUALITY = 72       # ... to keep it small enough to email
INK, INK_2, ACCENT, RULE = '#1a1d2e', '#5a6080', '#5b5ef4', '#e3e6f0'


def esc(v):
    return html.escape('' if v is None else str(v))


def fmt(n):
    n = float(n)
    return str(int(n)) if n.is_integer() else f'{n:g}'


def report_css():
    faces = ''
    if (FONT_DIR / 'segoeui.ttf').exists():
        faces = ('@font-face {font-family: Body; src: url(segoeui.ttf);}'
                 '@font-face {font-family: Body; src: url(segoeuib.ttf); font-weight: bold;}'
                 '@font-face {font-family: Sym; src: url(seguisym.ttf);}')
    return faces + f"""
      body {{ font-family: Body, Sym, sans-serif; font-size: 10pt; color: {INK}; }}
      h1 {{ font-size: 17pt; margin: 0; }}
      h2 {{ font-size: 12pt; margin: 16pt 0 5pt 0; padding-bottom: 2pt; border-bottom: 1pt solid {RULE}; }}
      h3 {{ font-size: 10.5pt; margin: 10pt 0 3pt 0; }}
      p {{ margin: 2pt 0; }}
      .muted {{ color: {INK_2}; }}
      .big {{ font-size: 26pt; font-weight: bold; }}
      .pct {{ font-size: 14pt; font-weight: bold; color: {INK_2}; }}
      table {{ border-collapse: collapse; }}
      td, th {{ padding: 3pt 4pt; vertical-align: top; text-align: left; }}
      th {{ color: {INK_2}; font-weight: normal; font-size: 9pt; border-bottom: 1pt solid {RULE}; }}
      .rows td {{ border-bottom: 0.5pt solid {RULE}; }}
      .num {{ text-align: right; white-space: nowrap; }}
      .card {{ margin: 0 0 7pt 0; padding: 5pt 7pt; border-left: 2.5pt solid {ACCENT}; background-color: #f4f4ff; }}
    """


# MuPDF's HTML engine honours column widths in points, not percent (a percent
# width collapses the column), so every width below is points of the 515pt
# text width of an A4 page with 40pt margins, LESS each cell's 8pt of padding
# (a width is the content box; padding is added on top), LESS about 12pt of
# slack: MuPDF spends a little more than that sum, and a table budgeted to the
# exact width ran past the margin and cut off the end of the longest line.
BAR_PT = 160


def bar_cell(marks, widest):
    width = max(4, round(BAR_PT * marks / widest)) if widest else 0
    return (f'<table style="width:{width}pt"><tr>'
            f'<td style="background-color:{ACCENT}; padding:0; height:7pt;"></td></tr></table>')


def report_html(d):
    r = d['report']
    c = r['counts']
    out = [
        f'<h1>{esc(d["title"])}</h1>',
        f'<p class="muted">{esc(d["student"])} &#183; {esc(d["subject"])} &#183; graded {esc(d["gradedOn"])}</p>',
        '<table style="margin-top:10pt"><tr>',
        f'<td style="width:200pt"><span class="big">{fmt(r["total"])} / {fmt(r["max"])}</span>'
        f' <span class="pct">{r["pct"]}%</span></td>',
        f'<td class="muted" style="width:283pt">Full marks: {c["full"]} &#183; Part marks: {c["partial"]} &#183; '
        f'No marks: {c["zero"]} &#183; Not attempted: {c["notAttempted"]}<br/>{c["questions"]} questions</td>',
        '</tr></table>',
    ]
    p = r['potential']
    if p['avoidable'] > 0:
        out.append(f'<p style="margin-top:6pt">Fix the calculation errors in {esc(", ".join(p["questions"]))} and this is '
                   f'<b>{fmt(p["marks"])} / {fmt(r["max"])} ({p["pct"]}%)</b>: {fmt(p["avoidable"])} '
                   f'mark{"" if p["avoidable"] == 1 else "s"} you already knew how to get.</p>')

    if r['lost']:
        widest = max(l['marks'] for l in r['lost'])
        out.append('<h2>Where your marks went</h2><table class="rows">')
        out.append(f'<tr><th style="width:130pt">Why</th><th style="width:{BAR_PT}pt"></th>'
                   '<th class="num" style="width:45pt">Marks</th><th style="width:136pt">Questions</th></tr>')
        for l in r['lost']:
            out.append(f'<tr><td>{esc(l["label"])}</td><td>{bar_cell(l["marks"], widest)}</td>'
                       f'<td class="num">&#8722;{fmt(l["marks"])}</td><td class="muted">{esc(", ".join(l["questions"]))}</td></tr>')
        out.append('</table>')

    if r['focus']:
        out.append('<h2>What to focus on</h2>')
        for f in r['focus']:
            out.append(f'<div class="card"><b>{esc(f["heading"])}</b> '
                       f'<span class="muted">({esc(f["label"])}, &#8722;{fmt(f["lost"])})</span>'
                       + (f'<br/>{esc(f["missing"])}' if f.get('missing') else '') + '</div>')
    if r['smallerFixes']:
        out.append('<h3>Smaller fixes</h3><table class="rows">')
        for f in r['smallerFixes']:
            out.append(f'<tr><td style="width:130pt"><b>{esc(f["heading"])}</b></td>'
                       f'<td style="width:298pt">{esc(f["advice"])} <span class="muted">{esc(", ".join(f["questions"]))}</span></td>'
                       f'<td class="num" style="width:45pt">&#8722;{fmt(f["marks"])}</td></tr>')
        out.append('</table>')

    out.append('<h2>Question by question</h2><table class="rows">')
    out.append('<tr><th style="width:40pt">Q</th><th class="num" style="width:55pt">Marks</th><th style="width:384pt">What was missing</th></tr>')
    for g in d['grades']:
        got = f'{fmt(g["awarded"])} / {fmt(g["maxMarks"])}' if g['outcome'] == 'scored' else f'&#8212; / {fmt(g["maxMarks"])}'
        note = 'Not attempted' if g['outcome'] != 'scored' else (g.get('missing') or '')
        out.append(f'<tr><td>{esc(g["label"])}</td><td class="num">{got}</td><td>{esc(note)}</td></tr>')
    out.append('</table>')

    out.append(f'<h2>What went well</h2><p>{esc(d["wentWell"])}</p>')
    out.append(f'<h2>What to work on next</h2><p>{esc(d["nextSteps"])}</p>')
    out.append(f'<p class="muted" style="margin-top:12pt">Your {d["pageCount"]} marked '
               f'page{"" if d["pageCount"] == 1 else "s"} follow.</p>')
    return '\n'.join(out)


def report(inbox):
    inbox = Path(inbox)
    prev = inbox / 'preview'
    d = json.loads((prev / 'report.json').read_text(encoding='utf-8'))
    count = d['pageCount']
    missing = [n for n in range(1, count + 1) if not (prev / f'{n:02d}.jpg').exists()]
    if missing:
        fail(f'marked pages {missing} are missing; run grading:preview again')

    path = prev / 'report.pdf'
    archive = fitz.Archive(str(FONT_DIR)) if FONT_DIR.exists() else None
    story = fitz.Story(html=report_html(d), user_css=report_css(), archive=archive)
    a4 = fitz.paper_rect('a4')
    where = a4 + (40, 40, -40, -40)
    summary = io.BytesIO()
    writer = fitz.DocumentWriter(summary)
    more = 1
    while more:
        dev = writer.begin_page(a4)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()

    doc = fitz.open('pdf', summary.getvalue())
    for n in range(1, count + 1):
        with Image.open(prev / f'{n:02d}.jpg') as src:
            img = src.convert('RGB')
        img.thumbnail((PDF_PAGE_SIDE, PDF_PAGE_SIDE), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=PDF_JPEG_QUALITY)
        # A4 width, the page's own aspect: no white bands, nothing cropped.
        page = doc.new_page(width=a4.width, height=a4.width * img.height / img.width)
        page.insert_image(page.rect, stream=buf.getvalue())
    # Embed only the characters used: the whole of Segoe UI is ~1.9 MB, ten
    # times the marked pages themselves.
    doc.subset_fonts()
    doc.save(str(path), garbage=3, deflate=True)
    doc.close()
    return str(path)


if __name__ == '__main__':
    commands = {'prepare': prepare, 'draw': draw, 'report': report}
    if len(sys.argv) in (4, 5) and sys.argv[1] == 'rotate':
        print(json.dumps(rotate(*sys.argv[2:])))
    elif len(sys.argv) != 3 or sys.argv[1] not in commands:
        fail('usage: pages.py prepare|draw|report <inbox folder>\n'
             '       pages.py rotate <inbox folder or submission id> <page> [left|right]')
    else:
        print(json.dumps(commands[sys.argv[1]](sys.argv[2])))
