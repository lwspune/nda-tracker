// A graded homework, summed up for the student: the score, where the marks
// went (by cause), what a careful second attempt is worth, and what to work on
// first. PURE. Imported by Node scripts (the PDF is built from this at commit),
// so relative imports carry their .js extension.
//
// Every number comes from the saved grade rows, never from a second count:
// the screen and the PDF both call this, and its losses add back up to the
// score (a test pins that).

// The order losses are shown in. `other`: lost marks saved before causes
// existed (2026-10-16), so the bars still add up for an old grade.
export const LOSS_ORDER = ['concept', 'incomplete', 'careless', 'misread', 'mcq', 'not_attempted', 'other']

// Student-facing wording. "careless" is the grader's category, never a word
// said to the student (GRADING.md, feedback style): it shows as "Slips".
const LOSS = {
  concept: { label: 'Concept gaps', heading: 'Learn this again', advice: 'Revise the idea, then redo these and compare with the solution.' },
  incomplete: { label: 'Steps left out', heading: 'Show full steps', advice: 'Redo these writing every step, reason and the final statement.' },
  careless: { label: 'Slips', heading: 'Slips in the working', advice: 'Redo these slowly and check each line and the final answer.' },
  misread: { label: 'Misread the question', heading: 'Read the question again', advice: 'Reread the question and check you answered what was asked.' },
  mcq: { label: 'Objective answers', heading: 'Check options slowly', advice: 'Retry these, checking every option before choosing.' },
  not_attempted: { label: 'Not attempted', heading: 'Not attempted', advice: 'Try these now: an attempt earns marks for the method.' },
  other: { label: 'Other marks lost', heading: 'Other marks lost', advice: 'Read the comments on these questions.' },
}

// One question's loss, for staff beside its marks: 'Concept gap: Chain rule'.
const ONE = { concept: 'Concept gap', incomplete: 'Steps left out', careless: 'Slip', misread: 'Misread the question', mcq: 'Objective answer' }
export function causeLabel(cause, topic) {
  const name = ONE[cause]
  if (!name) return ''
  return topic ? `${name}: ${topic}` : name
}

// Losses worth a "focus" card: they need learning, not just care.
const FOCUS_CAUSES = new Set(['concept', 'incomplete', 'misread'])
const MAX_FOCUS = 3

const num = v => (v === null || v === undefined ? null : Number(v))
// Sums of halves are exact in binary floating point; rounding guards anything else.
const tidy = n => Math.round(n * 100) / 100
const pctOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

function focusHeading(row) {
  if (row.cause === 'concept') return `Learn this again: ${row.topic}`
  if (row.cause === 'incomplete') return `Show full steps: ${row.topic}`
  return LOSS[row.cause].heading
}

// grades: [{ position, label, maxMarks, outcome, awarded, missing, cause, topic }]
export function buildPaperReport(grades) {
  const rows = [...(grades ?? [])]
    .map(r => ({ ...r, maxMarks: num(r.maxMarks), awarded: num(r.awarded) }))
    .sort((a, b) => a.position - b.position)

  const max = tidy(rows.reduce((s, r) => s + r.maxMarks, 0))
  const total = tidy(rows.reduce((s, r) => s + (r.outcome === 'scored' ? r.awarded : 0), 0))

  const counts = { questions: rows.length, full: 0, partial: 0, zero: 0, notAttempted: 0 }
  const losing = []
  for (const r of rows) {
    if (r.outcome !== 'scored') { counts.notAttempted++; losing.push({ ...r, key: 'not_attempted', lost: r.maxMarks }); continue }
    if (r.awarded === r.maxMarks) { counts.full++; continue }
    if (r.awarded === 0) counts.zero++
    else counts.partial++
    losing.push({ ...r, key: LOSS[r.cause] && r.cause !== 'not_attempted' && r.cause !== 'other' ? r.cause : 'other', lost: tidy(r.maxMarks - r.awarded) })
  }

  const byKey = key => losing.filter(r => r.key === key)
  const lost = LOSS_ORDER
    .map(key => ({ key, label: LOSS[key].label, marks: tidy(byKey(key).reduce((s, r) => s + r.lost, 0)), questions: byKey(key).map(r => r.label) }))
    .filter(l => l.marks > 0)

  const slips = byKey('careless')
  const avoidable = tidy(slips.reduce((s, r) => s + r.lost, 0))
  const potential = { marks: tidy(total + avoidable), pct: pctOf(total + avoidable, max), avoidable, questions: slips.map(r => r.label) }

  const focusRows = losing
    .filter(r => FOCUS_CAUSES.has(r.key))
    .sort((a, b) => b.lost - a.lost || a.position - b.position)
    .slice(0, MAX_FOCUS)
  const focus = focusRows.map(r => ({
    label: r.label, lost: r.lost, cause: r.key, heading: focusHeading(r), missing: r.missing ?? null,
  }))

  const inFocus = new Set(focusRows.map(r => r.label))
  const smallerFixes = LOSS_ORDER
    .map(key => {
      const left = byKey(key).filter(r => !inFocus.has(r.label))
      return {
        cause: key, heading: LOSS[key].heading, advice: LOSS[key].advice,
        questions: left.map(r => r.label), marks: tidy(left.reduce((s, r) => s + r.lost, 0)),
      }
    })
    .filter(f => f.questions.length > 0)

  return { total, max, pct: pctOf(total, max), counts, lost, potential, focus, smallerFixes }
}
