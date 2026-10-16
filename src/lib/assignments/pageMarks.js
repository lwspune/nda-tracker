// Marks written onto a student's pages: ticks, crosses, circles, short notes
// and each question's score. PURE. Imported by Node scripts, so relative
// imports carry their .js extension.
//
// The grader places them in grade.json's `marks` list, as percentages of the
// prepared page (scripts/grading/pages.py makes the pages and a labelled grid
// to read positions off). `grading:preview` draws them and the grader checks
// the drawing before `grading:commit` will save; the database repeats the
// shape rules (homework_page_marks).
//
// A score mark carries NO text: what it prints is worked out from the grade
// row (scoreText), so the page can never show a number the grade does not hold.

export const MARK_KINDS = ['tick', 'cross', 'circle', 'note', 'score']
export const MAX_NOTE_CHARS = 80
export const MAX_MARKS = 400
// Kinds that show where marks were lost; a question that lost marks needs one.
const LOSS_KINDS = ['cross', 'circle', 'note']

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v)
const onPage = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
const round1 = n => Math.round(n * 10) / 10
const text = v => (typeof v === 'string' ? v.trim() : '')

// '2.5/3'. Numbers print without trailing zeros.
export function scoreText(row) {
  return `${Number(row.awarded)}/${Number(row.maxMarks)}`
}

const rowState = row => (row.awarded === row.maxMarks ? 'full' : row.awarded === 0 ? 'zero' : 'partial')

// { marks, pageCount, rows } → { ok: true, marks } | { ok: false, errors }
// rows: validateGrade's rows ({ label, maxMarks, outcome, awarded }).
export function validateMarks({ marks, pageCount, rows }) {
  if (!Array.isArray(marks)) {
    return { ok: false, errors: ['grade.json needs a `marks` list: the ticks, crosses, notes and scores to write on the pages.'] }
  }
  const errors = []
  if (marks.length > MAX_MARKS) errors.push(`Use at most ${MAX_MARKS} marks (there are ${marks.length}).`)
  const byLabel = new Map((rows ?? []).map(r => [r.label, r]))
  const out = []

  marks.forEach((raw, i) => {
    const at = `Mark ${i + 1}`
    if (!isObject(raw)) { errors.push(`${at} is not an object.`); return }
    const label = text(raw.label)
    const row = byLabel.get(label)
    if (!row) { errors.push(`${at}: there is no question "${label}" in the grades.`); return }
    const here = `${at} (${label})`
    let bad = false
    const fail = msg => { errors.push(`${here}: ${msg}`); bad = true }

    const kind = raw.kind
    if (!MARK_KINDS.includes(kind)) { fail(`kind must be one of ${MARK_KINDS.join(', ')}.`); return }
    if (!Number.isInteger(raw.page) || raw.page < 1 || raw.page > pageCount) {
      fail(`page must be a whole number from 1 to ${pageCount}.`)
    }
    if (!onPage(raw.x) || !onPage(raw.y)) fail('x and y must be numbers from 0 to 100 (percent of the page).')

    const hasSize = raw.w !== undefined || raw.h !== undefined
    if (kind === 'circle') {
      const sized = v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100
      if (!sized(raw.w) || !sized(raw.h)) fail('a circle needs w and h, each above 0 and at most 100.')
    } else if (hasSize) {
      fail('only a circle has w and h.')
    }

    const note = text(raw.text)
    if (kind === 'note') {
      if (!note) fail('a note needs text.')
      else if (note.length > MAX_NOTE_CHARS) fail(`the note is over ${MAX_NOTE_CHARS} characters.`)
    } else if (raw.text !== undefined && raw.text !== null && raw.text !== '') {
      fail('only a note has text (a score prints the marks from the grade).')
    }

    if (raw.to !== undefined && raw.to !== null) {
      if (kind !== 'note') fail('only a note has `to`.')
      else if (!isObject(raw.to) || !onPage(raw.to.x) || !onPage(raw.to.y)) fail('`to` must be a point from 0 to 100: { "x": …, "y": … }.')
    }
    if (bad) return

    out.push({
      position: out.length + 1, page: raw.page, label, kind, x: round1(raw.x), y: round1(raw.y),
      w: kind === 'circle' ? round1(raw.w) : null,
      h: kind === 'circle' ? round1(raw.h) : null,
      text: kind === 'note' ? note : null,
      toX: kind === 'note' && raw.to ? round1(raw.to.x) : null,
      toY: kind === 'note' && raw.to ? round1(raw.to.y) : null,
    })
  })

  // Every question accounted for on the page. Counted over the raw list too, so
  // a malformed score still stops "place one" from being reported twice.
  const kindsFor = label => marks.filter(m => isObject(m) && text(m.label) === label).map(m => m.kind)
  for (const row of rows ?? []) {
    const kinds = kindsFor(row.label)
    const scores = kinds.filter(k => k === 'score').length
    if (row.outcome !== 'scored') {
      if (scores) errors.push(`${row.label}: not attempted, so it gets no score mark.`)
      continue
    }
    if (scores === 0) errors.push(`${row.label}: place one score mark (its marks, circled, beside the answer).`)
    if (scores > 1) errors.push(`${row.label} has ${scores} score marks; place exactly one.`)
    if (row.awarded === row.maxMarks) {
      if (kinds.some(k => LOSS_KINDS.includes(k))) {
        errors.push(`${row.label}: full marks, so only ticks and the score go on the page.`)
      }
    } else if (!kinds.some(k => LOSS_KINDS.includes(k))) {
      errors.push(`${row.label}: marks were lost, so show where: add a cross, circle or note at the step.`)
    }
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, marks: out }
}

// What scripts/grading/draw.py draws: every mark, a score's text and colour
// state taken from its grade row. Deterministic, so the preview stamp (a hash
// of this) changes whenever a mark OR a mark's score changes.
export function drawingPayload({ marks, rows }) {
  const byLabel = new Map(rows.map(r => [r.label, r]))
  return {
    marks: marks.map(m => {
      const row = byLabel.get(m.label)
      return {
        ...m,
        text: m.kind === 'score' ? scoreText(row) : m.text,
        state: m.kind === 'score' ? rowState(row) : null,
      }
    }),
  }
}
