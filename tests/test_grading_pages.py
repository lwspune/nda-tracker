"""Tests for scripts/grading/pages.py: preparing a student's pages, the
position grid, and drawing the grader's marks onto them."""

import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'grading'))

import fitz  # PyMuPDF
import pytest
from PIL import Image, ImageDraw

import pages

RED = (211, 47, 47)


def near(c, target, tol=60):
    return all(abs(a - b) <= tol for a, b in zip(c[:3], target))


def write_photo(path, size=(300, 200), orientation=None, colour=(255, 255, 255)):
    img = Image.new('RGB', size, colour)
    if orientation:
        exif = Image.Exif()
        exif[0x0112] = orientation
        img.save(path, exif=exif.tobytes())
    else:
        img.save(path)


def write_pdf(path, n):
    doc = fitz.open()
    for _ in range(n):
        doc.new_page(width=300, height=400)
    doc.save(path)


@pytest.fixture
def inbox(tmp_path):
    (tmp_path / 'scans').mkdir()
    return tmp_path


class TestPrepare:
    def test_rotates_a_photo_by_its_orientation_tag(self, inbox):
        write_photo(inbox / 'scans' / '01.jpg', size=(300, 200), orientation=6)  # "rotate 90"
        info = pages.prepare(str(inbox))
        assert info == [{'page': 1, 'source': 'scans/01.jpg', 'width': 200, 'height': 300}]
        assert Image.open(inbox / 'pages' / '01.jpg').size == (200, 300)

    def test_splits_a_pdf_into_its_pages_in_order(self, inbox):
        write_photo(inbox / 'scans' / '01.jpg')
        write_pdf(inbox / 'scans' / '02.pdf', 2)
        info = pages.prepare(str(inbox))
        assert [p['source'] for p in info] == ['scans/01.jpg', 'scans/02.pdf#1', 'scans/02.pdf#2']
        assert sorted(os.listdir(inbox / 'pages')) == ['01.jpg', '02.jpg', '03.jpg', 'pages.json']
        assert json.loads((inbox / 'pages' / 'pages.json').read_text()) == info

    # pdf2png.py writes 01-p01.png beside a PDF; those are not hand-in files.
    def test_reads_only_the_hand_in_files(self, inbox):
        write_photo(inbox / 'scans' / '01.jpg')
        write_photo(inbox / 'scans' / '01-p01.png')
        assert len(pages.prepare(str(inbox))) == 1

    def test_shrinks_a_large_photo_to_the_long_side_limit(self, inbox):
        write_photo(inbox / 'scans' / '01.jpg', size=(4000, 3000))
        info = pages.prepare(str(inbox))
        assert (info[0]['width'], info[0]['height']) == (pages.MAX_SIDE, 1500)

    def test_writes_a_grid_copy_of_each_page_at_the_same_size(self, inbox):
        write_photo(inbox / 'scans' / '01.jpg', size=(400, 600))
        pages.prepare(str(inbox))
        plain = Image.open(inbox / 'pages' / '01.jpg').convert('RGB')
        grid = Image.open(inbox / 'grid' / '01.jpg').convert('RGB')
        assert grid.size == plain.size
        # A line at 50% across, and nothing drawn on the clean page.
        assert grid.getpixel((200, 300)) != plain.getpixel((200, 300)) or grid.getpixel((200, 150)) != plain.getpixel((200, 150))
        assert near(plain.getpixel((200, 300)), (255, 255, 255), tol=8)

    def test_refuses_a_folder_with_no_pages(self, inbox):
        with pytest.raises(SystemExit):
            pages.prepare(str(inbox))


def marks_payload(marks, page_count=1):
    return {'pageCount': page_count, 'marks': marks}


def mark(kind, x=50, y=50, **over):
    m = {'position': 1, 'page': 1, 'label': 'Q1', 'kind': kind, 'x': x, 'y': y,
         'w': None, 'h': None, 'text': None, 'toX': None, 'toY': None, 'state': None}
    m.update(over)
    return m


class TestDraw:
    def setup_page(self, inbox, size=(1000, 1400)):
        (inbox / 'pages').mkdir()
        Image.new('RGB', size, (255, 255, 255)).save(inbox / 'pages' / '01.jpg')

    def run(self, inbox, marks, page_count=1):
        (inbox / 'preview').mkdir(exist_ok=True)
        (inbox / 'preview' / 'marks.json').write_text(json.dumps(marks_payload(marks, page_count)))
        pages.draw(str(inbox))
        return Image.open(inbox / 'preview' / '01.jpg').convert('RGB')

    def red_in(self, img, box):
        x0, y0, x1, y1 = box
        return any(near(img.getpixel((x, y)), RED) for x in range(x0, x1, 2) for y in range(y0, y1, 2))

    def test_draws_each_kind_in_red_where_it_was_placed(self, inbox):
        self.setup_page(inbox)
        for kind, extra in [('tick', {}), ('cross', {}), ('circle', {'w': 10, 'h': 4}),
                            ('note', {'text': 'Should be 5'}), ('score', {'text': '2.5/3', 'state': 'partial'})]:
            img = self.run(inbox, [mark(kind, **extra)])
            assert img.size == (1000, 1400)
            assert self.red_in(img, (420, 640, 640, 760)), kind
            assert not self.red_in(img, (0, 0, 120, 120)), kind

    def test_a_note_draws_a_line_to_the_point_it_names(self, inbox):
        self.setup_page(inbox)
        img = self.run(inbox, [mark('note', x=60, y=20, text='Sign', toX=20, toY=80)])
        assert self.red_in(img, (180, 1090, 220, 1150))  # near the far end of the line

    def test_a_long_note_stays_on_the_page(self, inbox):
        self.setup_page(inbox)
        img = self.run(inbox, [mark('note', x=90, y=50, text='Opposite angles of a cyclic quadrilateral add to 180')])
        assert self.red_in(img, (0, 600, 900, 800))

    def test_draws_on_the_page_each_mark_names(self, inbox):
        self.setup_page(inbox)
        Image.new('RGB', (1000, 1400), (255, 255, 255)).save(inbox / 'pages' / '02.jpg')
        self.run(inbox, [mark('cross', page=2)], page_count=2)
        first = Image.open(inbox / 'preview' / '01.jpg').convert('RGB')
        second = Image.open(inbox / 'preview' / '02.jpg').convert('RGB')
        assert not self.red_in(first, (420, 640, 580, 760))
        assert self.red_in(second, (420, 640, 580, 760))

    def test_refuses_marks_for_a_page_that_was_not_prepared(self, inbox):
        self.setup_page(inbox)
        with pytest.raises(SystemExit):
            self.run(inbox, [mark('cross', page=2)], page_count=2)

    # 2026-10-16: PIL's built-in font has no Greek, no minus sign and no ≠, so a
    # note about "Δu ≠ 0" printed as empty boxes on the student's page.
    @pytest.mark.skipif(not (pages.FONT_DIR / 'seguisym.ttf').exists(), reason='needs Segoe UI Symbol')
    def test_the_note_font_has_greek_and_maths_symbols(self):
        assert missing_glyphs(pages.font(40), 'ΔδθπλαΣ−≠±⇒∈²') == ''


def missing_glyphs(f, chars):
    """The characters f would draw as its empty box (the glyph a private-use
    code point gets, which no font draws)."""
    def drawn(ch):
        img = Image.new('L', (80, 80), 0)
        ImageDraw.Draw(img).text((10, 10), ch, fill=255, font=f)
        return img.tobytes()
    box = drawn('')
    return ''.join(ch for ch in chars if drawn(ch) == box)



def report_json(page_count=2):
    """What grading:commit writes: the header facts and buildPaperReport's output."""
    return {
        'title': 'Maths Daily Homework #3', 'subject': 'Maths', 'student': 'Test Student',
        'gradedOn': '16 Oct 2026', 'pageCount': page_count,
        'wentWell': 'Clear setup on Q1.', 'nextSteps': 'Write the condition before dividing.',
        'grades': [
            {'label': 'Q1', 'maxMarks': 5, 'outcome': 'scored', 'awarded': 5, 'missing': None},
            {'label': 'Q2', 'maxMarks': 5, 'outcome': 'scored', 'awarded': 2.5, 'missing': 'No reason for dividing: dx/dt ≠ 0.'},
            {'label': 'Q3', 'maxMarks': 5, 'outcome': 'not_attempted', 'awarded': None, 'missing': None},
        ],
        'report': {
            'total': 7.5, 'max': 15, 'pct': 50,
            'counts': {'questions': 3, 'full': 1, 'partial': 1, 'zero': 0, 'notAttempted': 1},
            'lost': [
                {'key': 'incomplete', 'label': 'Steps left out', 'marks': 2.5, 'questions': ['Q2']},
                {'key': 'not_attempted', 'label': 'Not attempted', 'marks': 5, 'questions': ['Q3']},
            ],
            'potential': {'marks': 7.5, 'pct': 50, 'avoidable': 0, 'questions': []},
            'focus': [{'label': 'Q2', 'lost': 2.5, 'cause': 'incomplete',
                       'heading': 'Show full steps: The condition dx/dt ≠ 0', 'missing': 'No reason for dividing.'}],
            'smallerFixes': [{'cause': 'not_attempted', 'heading': 'Not attempted', 'advice': 'Try these now.',
                              'questions': ['Q3'], 'marks': 5}],
        },
    }


class TestReport:
    def setup(self, inbox, pages_n=2):
        (inbox / 'preview').mkdir()
        for n in range(1, pages_n + 1):
            Image.new('RGB', (1125, 2000), (250, 250, 250)).save(inbox / 'preview' / f'{n:02d}.jpg')
        (inbox / 'preview' / 'report.json').write_text(json.dumps(report_json(pages_n)), encoding='utf-8')

    def test_builds_summary_pages_then_one_page_per_marked_page(self, inbox):
        self.setup(inbox)
        path = pages.report(str(inbox))
        with fitz.open(path) as doc:
            summary = doc.page_count - 2
            assert summary >= 1
            text = ''.join(doc[i].get_text() for i in range(summary))
            # The marked pages are images, one per page, after the summary.
            assert all(doc[i].get_images() for i in range(summary, doc.page_count))
        for expected in ['Maths Daily Homework #3', 'Test Student', '7.5 / 15', '50%',
                         'Steps left out', 'Show full steps', 'Not attempted', 'Q2',
                         'Clear setup on Q1.', 'Write the condition before dividing.']:
            assert expected in text, expected

    def test_keeps_maths_symbols_in_the_text(self, inbox):
        self.setup(inbox)
        with fitz.open(pages.report(str(inbox))) as doc:
            assert '≠' in doc[0].get_text()

    def test_keeps_the_file_small_enough_to_email(self, inbox):
        self.setup(inbox, pages_n=6)
        assert os.path.getsize(pages.report(str(inbox))) < 5 * 1024 * 1024

    # 2026-10-16: every column was budgeted to exactly the text width, MuPDF
    # spent more, and the table ran off the page, cutting the last words.
    def test_no_text_runs_past_the_right_margin(self, inbox):
        self.setup(inbox)
        d = report_json(2)
        long = ('The general-solution rules are not written before use (sin x = 0 gives x = nπ; '
                'cos x = cos α gives x = 2nπ ± α), and the answer leaves out n ∈ Z.')
        for g in d['grades']:
            g['missing'] = long
        d['report']['smallerFixes'][0]['advice'] = 'Redo these slowly and check each line and the final answer.'
        (inbox / 'preview' / 'report.json').write_text(json.dumps(d), encoding='utf-8')
        with fitz.open(pages.report(str(inbox))) as doc:
            right = doc[0].rect.width - 40
            for i in range(doc.page_count - 2):
                for block in doc[i].get_text('dict')['blocks']:
                    for line in block.get('lines', []):
                        for span in line['spans']:
                            if span['text'].strip():
                                assert span['bbox'][2] <= right + 0.5, span['text']

    def test_refuses_when_a_marked_page_is_missing(self, inbox):
        self.setup(inbox)
        os.remove(inbox / 'preview' / '02.jpg')
        with pytest.raises(SystemExit):
            pages.report(str(inbox))
