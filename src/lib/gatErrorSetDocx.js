// Word (.docx) rendering for a per-student GAT error set.
//
// Conventions are the same as the Maths practice set (US Letter, 0.5" margins,
// Cambria 10pt, two-column body) so the two papers look like a set, and the
// maths pipeline is the same LaTeX -> KaTeX -> MathML -> mathml2omml -> OMML
// chain. Most of GAT is prose, but Physics and Chemistry stems carry real
// formulae, so the pipeline earns its place.
//
// Three things this does that practiceSetDocx.js does not, and why:
//
// 1. It renders `context` — the Directions block or RC passage. Without it a
//    Cloze or comprehension question is unanswerable on paper. buildGatErrorSet
//    keeps context-sharing questions adjacent and flags the first with
//    `showContext`, so the block prints once above its group.
//
// 2. Questions and solutions are separate SECTIONS, not a stem followed by its
//    answer. The point of the document is a cold re-attempt; an answer visible
//    on the same page defeats it.
//
// 3. The cover carries no marks column. GAT has a chapter/subtopic taxonomy
//    (gatTaxonomy.js) but no weightage table, so "marks at stake" — the axis the
//    Maths set ranks on — does not exist here. Volume is the axis instead.
//
// The maths pipeline comes from `src/lib/docxMath.js`. It used to be a verbatim
// copy of practiceSetDocx's, which is how the single-pass marker-swap fix had to
// be applied twice by hand; both papers now degrade identically by construction
// rather than by diligence.

import { parseTableBlocks } from './richText'
import { createMathRenderer, applyOmml } from './docxMath'
import { safeFilename } from './download'

const MARGIN = 720               // 0.5" in twips
const FONT = 'Cambria'
const SIZE = 20                  // 10pt, in half-points
const SMALL = 18                 // 9pt
const TITLE_SIZE = 28            // 14pt
const SUB_SIZE = 24              // 12pt



// Local: used by stripAnswerPrefix below, which is unrelated to the maths
// pipeline that moved to docxMath.js.
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const TAG_COLOR = { wrong: 'B00020', skipped: '8A6D00' }
const LABELS = ['a', 'b', 'c', 'd']


// Solutions in the bank routinely open with "Answer: B." — the letter is
// already printed on its own line, so strip the duplicate rather than say it
// twice.
const stripAnswerPrefix = (solution, answer) => {
  const a = String(answer || '').trim().toUpperCase()
  if (!a) return solution
  return String(solution).replace(
    new RegExp(`^\\s*(?:ans(?:wer)?|option)\\s*[:.\\-]?\\s*\\(?${escapeRegex(a)}\\)?\\s*[.:\\-—]?\\s*`, 'i'),
    '')
}

const P = { deps: 4, cover: 10, body: 12, bodyEnd: 62, solutions: 74, pack: 80, equations: 90, zip: 96, done: 100 }

export async function buildGatErrorSetDocx({
  studentName, subject = 'GAT', subjects, totals, meta = {}, onProgress,
  includeSolutions = true,
}) {
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

  // One renderer per document: the OMML it collects is positional, so
  // ommlByIndex must be the renderer's own array, not a fresh one.
  const { mathRuns, contentTable, TABLE_BORDERS, ommlByIndex } = await createMathRenderer(docxMod)

  const blank = () => new Paragraph({ children: [] })
  const cell = (text, header = false, width) => new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { fill: 'EEEEEE' } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: header, size: SIZE })] })],
  })

  // Prose that may carry a GFM pipe-table, as paragraphs + real Word tables.
  const proseBlocks = (text, extra = {}) => {
    const out = []
    parseTableBlocks(text).forEach(b => {
      if (b.kind === 'table') out.push(contentTable(b))
      else out.push(new Paragraph({ children: mathRuns(b.text, extra) }))
    })
    return out
  }

  // ── cover ───────────────────────────────────────────────────────────────
  const cover = []
  cover.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `NDA ${subject} — Wrong & Skipped Questions`, bold: true, size: TITLE_SIZE })],
  }))
  cover.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: studentName, bold: true, size: SUB_SIZE })],
  }))
  if (meta.subtitle) {
    cover.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: meta.subtitle, size: SIZE, color: '666666' })],
    }))
  }
  cover.push(blank())
  cover.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          cell('Subject', true, 40), cell('Chapters', true, 15),
          cell('Wrong', true, 15), cell('Skipped', true, 15), cell('Total', true, 15),
        ],
      }),
      ...subjects.map(s => new TableRow({
        children: [
          cell(s.subject), cell(s.chapters.length),
          cell(s.counts.wrong), cell(s.counts.skipped),
          cell(s.counts.wrong + s.counts.skipped),
        ],
      })),
      new TableRow({
        children: [
          cell('TOTAL', true), cell(subjects.reduce((n, s) => n + s.chapters.length, 0), true),
          cell(totals.counts.wrong, true), cell(totals.counts.skipped, true),
          cell(totals.questions, true),
        ],
      }),
    ],
  }))
  cover.push(new Paragraph({
    spacing: { before: 160 },
    children: [new TextRun({
      text: 'Every question here is one you got wrong or left blank in a mock. '
        + 'Each is tagged [WRONG] or [SKIPPED] and, where the paper recorded it, its difficulty. '
        + (includeSolutions
          ? 'Attempt them cold — the solutions are in a separate section at the back, on purpose.'
          : 'Attempt them cold — your teacher has the solutions.'),
      size: SMALL, italics: true, color: '666666',
    })],
  }))
  if (meta.notes?.length) {
    cover.push(blank())
    meta.notes.forEach(note => cover.push(new Paragraph({
      children: [new TextRun({ text: `• ${note}`, size: SMALL, color: '666666' })],
    })))
  }

  // ── questions, two columns ──────────────────────────────────────────────
  await report(P.cover, 'Building the summary…')
  const body = []
  const span = P.bodyEnd - P.body
  let done = 0
  const totalChapters = subjects.reduce((n, s) => n + s.chapters.length, 0)

  for (const s of subjects) {
    body.push(new Paragraph({
      spacing: { before: 280, after: 60 },
      children: [new TextRun({ text: s.subject.toUpperCase(), bold: true, size: TITLE_SIZE })],
    }))
    for (const c of s.chapters) {
      await report(P.body + (span * done) / Math.max(1, totalChapters),
        `Rendering questions… ${done + 1} of ${totalChapters}`)
      done += 1
      body.push(new Paragraph({
        spacing: { before: 200, after: 40 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999', space: 1 } },
        children: [new TextRun({ text: c.chapter, bold: true, size: SUB_SIZE })],
      }))
      body.push(new Paragraph({
        children: [new TextRun({
          text: `${c.counts.wrong} wrong · ${c.counts.skipped} skipped`,
          size: SMALL, color: '666666',
        })],
      }))

      c.questions.forEach(q => {
        if (q.showContext && q.context) {
          body.push(blank())
          proseBlocks(q.context, { italics: true, size: SMALL }).forEach(p => body.push(p))
        }
        body.push(blank())
        // Factories, not shared instances — a docx run belongs to one paragraph.
        const numRun = () => new TextRun({ text: `Q${q.n}. `, bold: true })
        const tagRun = () => new TextRun({
          text: ` [${q.bucket.toUpperCase()}]${q.difficulty ? ` [${q.difficulty.toUpperCase()}]` : ''}`
            + `${q.repeats.length ? ` [SEEN ${q.repeats.length + 1}×]` : ''}`,
          bold: true, size: 15, color: TAG_COLOR[q.bucket] || '555555',
        })
        // The question NUMBER rides on the first paragraph and the tag on the
        // last prose one, so a stem that opens or ends with a table keeps both.
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
            children: [new TextRun({ text: `(${LABELS[oi]}) ` }), ...mathRuns(o)],
          }))
        })
      })
    }
  }

  // ── solutions, two columns, keyed by question number ────────────────────
  // Skipped entirely (not merely hidden) when the caller asks for a
  // questions-only copy: the answers must not be present in the file at all,
  // since anything in document.xml is one Ctrl+F away.
  await report(P.bodyEnd, includeSolutions ? 'Building the solutions…' : 'Laying out the document…')
  const solutions = !includeSolutions ? [] : [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'Solutions', bold: true, size: TITLE_SIZE })],
  })]
  const allQuestions = includeSolutions
    ? subjects.flatMap(s => s.chapters.flatMap(c => c.questions))
    : []
  allQuestions.forEach(q => {
    const letter = LABELS[['A', 'B', 'C', 'D'].indexOf(String(q.answer).trim().toUpperCase())]
    solutions.push(new Paragraph({
      spacing: { before: 120 },
      children: [
        new TextRun({ text: `Q${q.n}. `, bold: true }),
        new TextRun({ text: `Answer: (${letter || q.answer || '?'})`, bold: true, color: '0F7B4F' }),
        new TextRun({
          text: `  ${q.chapter}${q.subtopic ? ` › ${q.subtopic}` : ''} · ${q.examName} (${q.examDate})`,
          size: 15, color: '666666',
        }),
      ],
    }))
    const text = stripAnswerPrefix(q.solution, q.answer).trim()
    if (text) proseBlocks(text).forEach(p => solutions.push(p))
    else {
      solutions.push(new Paragraph({
        children: [new TextRun({ text: 'No worked solution recorded for this question.', italics: true, size: SMALL, color: '666666' })],
      }))
    }
  })
  await report(P.solutions, 'Laying out the document…')

  const page = {
    size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
    margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, header: 0, footer: 0 },
  }
  const twoCol = { count: 2, space: 720 }
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [
      { properties: { page }, children: cover },
      { properties: { page, column: twoCol }, children: body },
      ...(includeSolutions ? [{ properties: { page, column: twoCol }, children: solutions }] : []),
    ],
  })

  await report(P.pack, 'Packing…')
  const blob = await Packer.toBlob(doc)
  const zip = await JSZip.loadAsync(blob)
  await report(P.equations, 'Placing equations…')
  await applyOmml(zip, ommlByIndex)
  await report(P.zip, 'Finishing the file…')
  const out = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  await report(P.done, 'Done')
  return out
}

// Word filename for one student's error set. Same sanitising rule as the
// monthly-report helpers — keep [A-Za-z0-9_-], collapse every other run to a
// single underscore — so a name with an apostrophe or a slash can't produce a
// path the ZIP writer rejects.
export function errorSetFilename(studentName, rangeLabel) {
  const safe = s => safeFilename(s, '')
  return `${safe(studentName)}_${safe(rangeLabel)}_Errors.docx`
}
