"""Tests for scripts/grading/pages.py: preparing a student's pages, the
position grid, and drawing the grader's marks onto them."""

import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'grading'))

import fitz  # PyMuPDF
import pytest
from PIL import Image

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
