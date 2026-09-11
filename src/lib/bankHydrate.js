// Merging PYQ Vault question content into an exam's stored questions[].
//
// The tracker's copy of a question is the record of what the student ACTUALLY
// SAT. The bank's copy is live and keeps improving — stems get repaired, keys
// get corrected, diagrams get attached. Those are two different things, and
// conflating them is how a past paper silently changes under a student months
// after the fact (the same class of bug as retiming a timetable slot and
// rewriting every absence filed against it).
//
// So this core does exactly two things:
//   • FILLS what the stored question doesn't have — above all images, which the
//     text-only Tags sheet drops entirely, so they are absent by construction.
//   • REPORTS what disagrees, and changes nothing. Applying a correction is a
//     faculty decision made against a visible diff, not a side effect of
//     opening a page.
//
// Pure: no fetch, no store, no DOM. The caller supplies `bankById`, however it
// obtained it (see CROSS_APP_SYNC.md for the read API this pairs with).

// The allow-list is a boundary, not documentation: hydration writes into the
// `exams.questions` jsonb, so without it a payload change upstream could put
// arbitrary keys into our rows. `q` and `questionId` are deliberately ABSENT —
// the tracker owns its own numbering, and the id is the join key itself.
// `format` and `numericAnswer` are deliberately ABSENT: nothing in this app
// reads a per-question format (the exam-level one is derived by `examFormat`),
// and NDA papers carry no numeric-answer questions. Hydrating them wrote 'mcq'
// into all 120 questions of every paper — dead weight in a jsonb that also
// ships to students. Add them back when something actually reads them.
export const HYDRATABLE_FIELDS = [
  'subject', 'chapter', 'subtopic',
  'question', 'optionA', 'optionB', 'optionC', 'optionD',
  'answer', 'solution', 'difficulty', 'context',
  'subtopicSlug', 'conceptSlug',
  'imageUrl', 'solutionImageUrl', 'optionImages',
]

// Absent = nothing worth protecting. A blank cell in a tags file arrives as
// null or '', and both mean "never filled in" — not "deliberately empty".
//
// A CONTAINER whose every value is absent is absent too. `optionImages` always
// arrives as {A,B,C,D}, so without this a question with no option images at all
// still counted as a find: one mock reported "236 fields to fill" while the
// bank held zero images for it. An empty box is not content.
function isAbsent(v) {
  if (v === undefined || v === null || v === '') return true
  if (Array.isArray(v)) return v.every(isAbsent)
  if (typeof v === 'object') return Object.values(v).every(isAbsent)
  return false
}

// Line endings and trailing spaces are NOT a change.
//
// The Tags xlsx round-trip normalises CRLF to LF while the bank stores CRLF, so
// byte equality reported EVERY multi-line solution as a conflict: one mock
// showed 33 differing solutions of which precisely zero were real (2026-09-11).
// A conflict list that cries wolf is worse than none — faculty would have
// hand-"corrected" 33 identical solutions.
//
// Only the COMPARISON is normalised. What gets stored is never touched.
function comparable(v) {
  if (typeof v !== 'string') return v
  return v
    .replace(/\r\n?/g, '\n')      // CRLF / CR -> LF
    .replace(/[ \t]+$/gm, '')     // trailing spaces on any line
    .trim()
}

function sameValue(a, b) {
  if (a === b) return true
  if (typeof a === 'string' && typeof b === 'string') {
    return comparable(a) === comparable(b)
  }
  // optionImages is a small flat object; compare by value so an equal map
  // doesn't read as a conflict on every hydrate.
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

/**
 * @param {Array} questions  an exam's stored questions[]
 * @param {Object} bankById  { [questionId]: bankQuestion } — whatever the bank returned
 * @returns {{questions: Array, filled: Array, differs: Array, missing: Array, unlinked: number}}
 *   `questions` is a new array (inputs are never mutated); `filled` and
 *   `differs` name the question by its printed number so a reviewer can find it;
 *   `missing` lists ids the bank returned nothing for. TWO causes, and the bank
 *   makes them indistinguishable on purpose: the id names no row (a stem repair
 *   there is a delete-and-re-commit that mints a NEW uuid), OR it names another
 *   institute's PRIVATE row — the same reason an unknown secret gets the same
 *   401 as no secret. So report these as "not available from the bank" and show
 *   the id; do NOT tell anyone the question was repaired. Signal, never noise:
 *   don't drop them silently.
 */
export function hydrateQuestions(questions, bankById) {
  const filled = []
  const differs = []
  const missing = []
  let unlinked = 0

  const out = (questions || []).map(q => {
    if (!q || !q.questionId) {
      if (q) unlinked += 1
      return q
    }
    const bank = (bankById || {})[q.questionId]
    if (!bank) {
      missing.push(q.questionId)
      return q
    }

    const next = { ...q }
    for (const field of HYDRATABLE_FIELDS) {
      const bankValue = bank[field]
      if (isAbsent(bankValue)) continue
      if (isAbsent(next[field])) {
        next[field] = bankValue
        filled.push({ q: q.q, field })
      } else if (!sameValue(next[field], bankValue)) {
        differs.push({ q: q.q, field, stored: next[field], bank: bankValue })
      }
    }
    return next
  })

  return { questions: out, filled, differs, missing, unlinked }
}
