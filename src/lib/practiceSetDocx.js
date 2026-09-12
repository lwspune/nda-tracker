// Word (.docx) rendering for a per-student practice set.
//
// Conventions and the maths pipeline are lifted from PYQ Vault's
// src/lib/export/docxBuilder.ts so both apps produce the same-looking paper:
// US Letter, 0.5" margins, Cambria 10pt, two-column question body.
//
// Maths is rendered as REAL Word equations, not ASCII. That pipeline now lives
// in `src/lib/docxMath.js` — it was copied into `gatErrorSetDocx` once already,
// and the class exam report would have been copy three.
//
// The heavy imports here are dynamic: docx is large, and nobody who does not
// click Download should pay for it. The two modules below are pure, tiny, and
// live in this same lazy chunk.

import { parseTableBlocks } from './richText'
import { createMathRenderer, applyOmml } from './docxMath'

const MARGIN = 720               // 0.5" in twips
const FONT = 'Cambria'
const SIZE = 20                  // 10pt, in half-points
const TITLE_SIZE = 28            // 14pt
const SUB_SIZE = 24              // 12pt

const TAG_COLOR = {
  wrong: 'B00020', skipped: '8A6D00', absent: '555555', right: '0F7B4F',
}

// Progress checkpoints. The build is one long synchronous CPU block — KaTeX per
// equation, then Packer, then the JSZip patch — so a caller that just flips a
// boolean gets no repaint until it is over. `onProgress(pct, label)` is AWAITED
// at each checkpoint: the caller returns a promise that yields a frame, and that
// yield is the only reason a bar can move. Weights are fixed, not measured; the
// question stretch is the bulk of the wall-clock and gets the widest band.
const P = { deps: 4, cover: 12, body: 15, bodyEnd: 70, pack: 75, equations: 85, zip: 95, done: 100 }

export async function buildPracticeSetDocx({ studentName, subject = 'Maths', rows, totals, onProgress }) {
  const report = typeof onProgress === 'function'
    ? (pct, label) => onProgress(Math.round(pct), label)
    : () => {}

  await report(0, 'Loading the builder…')
  const [docxMod, JSZipMod] = await Promise.all([
    import('docx'),
    import('jszip'),
  ])
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, PageOrientation,
  } = docxMod
  const JSZip = JSZipMod.default
  await report(P.deps, 'Loading the builder…')

  // One renderer per document: the OMML it collects is positional.
  const { mathRuns, contentTable, TABLE_BORDERS, ommlByIndex } = await createMathRenderer(docxMod)

  const blank = () => new Paragraph({ children: [] })
  const cell = (text, header = false, width) => new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { fill: 'EEEEEE' } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: header, size: SIZE })] })],
  })

  // ── cover: name + summary table (single column — a 7-column table is
  //    unreadable at half width) ─────────────────────────────────────────────
  const cover = []
  cover.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `NDA ${subject} — Personal Practice Set`, bold: true, size: TITLE_SIZE })],
  }))
  cover.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: studentName, bold: true, size: SUB_SIZE })],
  }))
  cover.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Top ${rows.length} subtopics by marks recoverable`, size: SIZE, color: '666666' })],
  }))
  cover.push(blank())
  cover.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell('Subtopic', true, 38), cell('Chapter', true, 22),
          cell('Wrong', true, 8), cell('Skipped', true, 8),
          cell('Right', true, 8), cell('Absent', true, 8), cell('Marks lift', true, 8),
        ],
      }),
      ...rows.map(r => new TableRow({
        children: [
          cell(r.subtopic), cell(r.chapter),
          cell(r.counts.wrong), cell(r.counts.skipped),
          cell(r.counts.right), cell(r.counts.absent),
          cell(`+${r.lift.toFixed(1)}`),
        ],
      })),
      new TableRow({
        children: [
          cell('TOTAL', true), cell('', true),
          cell(totals.counts.wrong, true), cell(totals.counts.skipped, true),
          cell(totals.counts.right, true), cell(totals.counts.absent, true),
          cell(`+${totals.lift.toFixed(1)}`, true),
        ],
      }),
    ],
  }))
  cover.push(new Paragraph({
    spacing: { before: 120 },
    children: [new TextRun({
      text: 'Marks lift = what is still on the table in that subtopic (NDA weightage minus your projected score). '
        + 'Each question is tagged with how you handled it and its difficulty. Answer key at the end.',
      size: 18, italics: true, color: '666666',
    })],
  }))

  // ── questions, two columns ──────────────────────────────────────────────
  await report(P.cover, 'Building the summary…')
  const body = []
  const labels = ['a', 'b', 'c', 'd']
  // for...of, not forEach — this loop has to await the progress seam, and it is
  // where the time goes (every equation is a KaTeX render).
  const span = P.bodyEnd - P.body
  for (const [i, r] of rows.entries()) {
    await report(P.body + (span * i) / rows.length,
      `Rendering questions… ${i + 1} of ${rows.length}`)
    body.push(new Paragraph({
      spacing: { before: 200, after: 40 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999', space: 1 } },
      children: [new TextRun({ text: r.subtopic, bold: true, size: SUB_SIZE })],
    }))
    body.push(new Paragraph({
      children: [new TextRun({
        text: `${r.chapter} · ${r.marksAtStake.toFixed(1)} marks at stake · +${r.lift.toFixed(1)} recoverable`,
        size: 18, color: '666666',
      })],
    }))
    if (!r.questions.length) {
      body.push(new Paragraph({
        children: [new TextRun({ text: 'No questions available for this subtopic yet.', italics: true, size: SIZE })],
      }))
      continue
    }
    r.questions.forEach(q => {
      body.push(blank())
      // Factories, not shared instances — a docx run object belongs to one
      // paragraph.
      const numRun = () => new TextRun({ text: `Q${q.n}. `, bold: true })
      const tagRun = () => new TextRun({
        text: ` [${q.bucket.toUpperCase()}]${q.difficulty ? ` [${q.difficulty.toUpperCase()}]` : ''}`,
        bold: true, size: 15, color: TAG_COLOR[q.bucket],
      })
      // A stem may carry a GFM pipe-table, which has to become a real Word
      // table rather than print as raw pipes. The question NUMBER rides on the
      // first paragraph and the bucket tag on the last prose one; a stem that
      // opens with a table, or ends with one, gets each as its own paragraph so
      // neither is lost. Options are never tables.
      const blocks = parseTableBlocks(q.question)
      const lastText = blocks.reduce((acc, b, i) => (b.kind === 'text' ? i : acc), -1)
      let numbered = false
      let tagged = false
      blocks.forEach((b, i) => {
        if (b.kind === 'table') {
          if (!numbered) {
            body.push(new Paragraph({ children: [numRun()] }))
            numbered = true
          }
          body.push(contentTable(b))
          return
        }
        const withTag = i === lastText
        body.push(new Paragraph({
          children: [
            ...(numbered ? [] : [numRun()]),
            ...mathRuns(b.text),
            ...(withTag ? [tagRun()] : []),
          ],
        }))
        numbered = true
        tagged = tagged || withTag
      })
      if (!numbered) body.push(new Paragraph({ children: [numRun(), tagRun()] }))
      else if (!tagged) body.push(new Paragraph({ children: [tagRun()] }))
      q.options.forEach((o, oi) => {
        if (!o) return
        body.push(new Paragraph({
          indent: { left: 0 },
          children: [new TextRun({ text: `(${labels[oi]}) ` }), ...mathRuns(o)],
        }))
      })
    })
  }
  await report(P.bodyEnd, 'Building the answer key…')

  // ── answer key: compact grid, answers only ──────────────────────────────
  const key = rows.flatMap(r => r.questions.map(q => ({ n: q.n, answer: q.answer })))
  const keySection = [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Answer Key', bold: true, size: TITLE_SIZE })],
  }), blank()]
  const PAIRS = 6
  const keyRows = []
  for (let i = 0; i < key.length; i += PAIRS) {
    const slice = key.slice(i, i + PAIRS)
    const cells = []
    for (let j = 0; j < PAIRS; j++) {
      const k = slice[j]
      cells.push(cell(k ? k.n : '', false, 8))
      cells.push(cell(k ? (k.answer || '?').toLowerCase() : '', true, 8))
    }
    keyRows.push(new TableRow({ children: cells }))
  }
  if (keyRows.length) {
    keySection.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: keyRows,
    }))
  }

  const page = {
    size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
    margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, header: 0, footer: 0 },
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [
      { properties: { page }, children: cover },
      { properties: { page, column: { count: 2, space: 720 } }, children: body },
      { properties: { page }, children: keySection },
    ],
  })

  // Pack, then swap markers for real OMML and inject mathPr.
  await report(P.pack, 'Laying out the document…')
  const blob = await Packer.toBlob(doc)
  const zip = await JSZip.loadAsync(blob)
  await report(P.equations, 'Placing equations…')
  await applyOmml(zip, ommlByIndex)
  // JSZip defaults to application/zip; give it the real OOXML type so the OS
  // and mail clients treat the file as a Word document rather than an archive.
  await report(P.zip, 'Finishing the file…')
  const out = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  await report(P.done, 'Done')
  return out
}

export async function downloadPracticeSet(args, filename) {
  const blob = await buildPracticeSetDocx(args)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
