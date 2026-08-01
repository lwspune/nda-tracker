// Per-student practice set — the questions behind a subtopic's number.
//
// Pure. Given a student's subtopic breakdown (from computeProjectedScore with
// { withSubtopics: true }), the exams they sat, and the exams their batch sat
// that they did NOT, this returns the top-N subtopics by marks recoverable with
// every question in each, split four ways.
//
// Two rules worth stating because both were bugs before they were rules:
//
// 1. Questions are matched on SUBTOPIC NAME ALONE, never chapter+subtopic.
//    Subtopic names are globally unique in the taxonomy, and some questions are
//    tagged under a different chapter than PYQ Vault assigns ("Continuity and
//    Differentiability" sits under Differentiation here, Limits & Continuity
//    there). Keying on the pair silently drops those.
//
// 2. The bucket comes from the Evalbee verdict in `responses` (1 / -1 / 0),
//    never from comparing against questions[].answer — see the grading
//    invariant in CLAUDE.md. A student with no result row for an exam
//    contributes nothing from it; that exam's questions are `absent` instead.

export const BUCKETS = ['wrong', 'skipped', 'absent', 'right']

const VERDICT = { 1: 'right', '-1': 'wrong', 0: 'skipped' }

function toQuestion(q, exam, bucket) {
  return {
    q: q.q,
    bucket,
    chapter: q.chapter || '',
    subtopic: q.subtopic || '',
    difficulty: q.difficulty ? String(q.difficulty) : '',
    question: q.question || '',
    options: [q.optionA, q.optionB, q.optionC, q.optionD].map(o => o || ''),
    answer: q.answer || '',
    examId: exam.id,
    examName: exam.name,
    examDate: exam.date,
  }
}

// buildPracticeSet({ subtopicBreakdown, exams, name, absentExams, topN })
//   subtopicBreakdown — projected.subtopicBreakdown (already sorted by gap, but
//                       re-sorted here so the caller can pass any order)
//   exams             — exams in scope for this student (each with students[])
//   absentExams       — exams the student's batch sat that they have no result
//                       row in. Empty is valid: the absent bucket is simply 0.
//   topN              — how many subtopics to include (default 10)
export function buildPracticeSet({
  subtopicBreakdown = [],
  exams = [],
  name,
  names,
  absentExams = [],
  topN = 10,
} = {}) {
  // Accept every spelling this student's results are filed under. Matching a
  // single canonical name misses results stored under a name_variant, which
  // makes sat exams look unsat — the bucket then reads `absent`.
  const who = new Set((names && names.length ? names : [name]).filter(Boolean))
  // Bucket every question once, keyed by subtopic name.
  const byName = new Map()
  const add = (q, exam, bucket) => {
    const key = q.subtopic || ''
    if (!key) return
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(toQuestion(q, exam, bucket))
  }

  exams.forEach(exam => {
    const student = (exam.students || []).find(s => who.has(s.name))
    if (!student) return
    ;(exam.questions || []).forEach(q => {
      const bucket = VERDICT[student.responses?.[q.q]]
      if (bucket) add(q, exam, bucket)
    })
  })

  absentExams.forEach(exam => {
    ;(exam.questions || []).forEach(q => add(q, exam, 'absent'))
  })

  const rows = [...subtopicBreakdown]
    .sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0))
    .slice(0, topN)
    .map(r => {
      const pool = byName.get(r.subtopic) || []
      const questions = BUCKETS.flatMap(b => pool.filter(q => q.bucket === b))
      const counts = { right: 0, wrong: 0, skipped: 0, absent: 0 }
      questions.forEach(q => { counts[q.bucket] += 1 })
      return {
        subtopic: r.subtopic,
        chapter: r.chapter,
        marksAtStake: r.marksAtStake ?? 0,
        projected: r.projected ?? 0,
        lift: r.gap ?? 0,
        counts,
        questions,
      }
    })

  // Sequential numbering across the whole set — the answer key keys off it.
  let n = 0
  rows.forEach(r => r.questions.forEach(q => { q.n = ++n }))

  const totals = {
    questions: n,
    lift: rows.reduce((s, r) => s + r.lift, 0),
    counts: rows.reduce((acc, r) => {
      BUCKETS.forEach(b => { acc[b] += r.counts[b] })
      return acc
    }, { right: 0, wrong: 0, skipped: 0, absent: 0 }),
  }

  return { rows, totals }
}

// Exams the student's batch sat that they have no result row in.
// `exam.batch` is a comma-joined list of batch names — split it. An exam tagged
// to another cohort that one batch-mate happened to sit is NOT an absence for
// this student, which is why the batch tag is the discriminator rather than
// "some classmate has a result here".
export function findAbsentExams({ exams = [], name, names, batches = [] }) {
  if (!batches.length) return []
  const mine = new Set(batches)
  const who = new Set((names && names.length ? names : [name]).filter(Boolean))
  return exams.filter(e => {
    if (!e.batch || !e.questions?.length) return false
    const tagged = String(e.batch).split(',').map(s => s.trim()).some(b => mine.has(b))
    if (!tagged) return false
    return !(e.students || []).some(s => who.has(s.name))
  })
}
