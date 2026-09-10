// Per-student GAT error set — every question a student got wrong or skipped,
// grouped Subject -> Chapter.
//
// Pure. The sibling of practiceSet.js, and deliberately NOT the same function.
// The Maths practice set ranks subtopics by marks recoverable, which it can do
// because ndaSubtopics.js carries a share-within-chapter for all 111 Maths
// subtopics. gatTaxonomy.js has the GAT chapter->subtopic tree but NO
// weightage, so "marks at stake" has no GAT analogue at all. The ranking axis
// here is therefore volume — how many questions in this chapter went wrong or
// unattempted — and the cover carries no marks column.
//
// Four rules, each of which is a rule because getting it wrong is silent:
//
// 1. The bucket comes from the Evalbee verdict in `responses` (1 / -1 / 0),
//    never from comparing a chosen letter against questions[].answer. See the
//    grading invariant in CLAUDE.md: Evalbee's mark is authoritative and a
//    corrected key does not re-grade.
//
// 2. Matching takes `names[]`, not one canonical name. Results are filed under
//    whatever the Evalbee sheet spelled; matching the canonical name alone
//    reports a variant-filed student as having sat nothing.
//
// 3. A question whose `context` (the Directions block or the RC passage) is
//    missing is unanswerable on paper. Questions sharing a context are kept
//    ADJACENT so the renderer can print the block once, above the first of
//    them — which is why context grouping outranks bucket ordering inside a
//    chapter.
//
// 4. A stem repeated across mocks is printed once. Which sitting is kept is not
//    cosmetic: the earliest is, so the repeat reads as history rather than as
//    two unrelated questions, and the later sittings ride along in `repeats`.

export const GAT_BUCKETS = ['wrong', 'skipped']

// Print order within a context group. `absent` is not in GAT_BUCKETS because it
// is not a verdict — it is the whole of a paper the student never sat, opted in
// separately — but it still needs a defined position, and indexOf(-1) would
// silently sort it FIRST.
const BUCKET_ORDER = ['wrong', 'skipped', 'absent']

const VERDICT = { 1: 'right', '-1': 'wrong', 0: 'skipped' }

// Stems differ across sheets only by whitespace far more often than by wording.
const stemKey = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

const byDateThenQ = (a, b) =>
  String(a.examDate).localeCompare(String(b.examDate)) || (a.q ?? 0) - (b.q ?? 0)

function toQuestion(q, exam, bucket) {
  return {
    q: q.q,
    bucket,
    subject: q.subject || 'Others',
    chapter: q.chapter || '(untagged)',
    subtopic: q.subtopic && q.subtopic !== 'General' ? q.subtopic : '',
    difficulty: q.difficulty ? String(q.difficulty) : '',
    context: q.context || '',
    question: q.question || '',
    options: [q.optionA, q.optionB, q.optionC, q.optionD].map(o => o || ''),
    answer: q.answer || '',
    solution: q.solution || '',
    examId: exam.id,
    examName: exam.name,
    examDate: exam.date,
    repeats: [],
    showContext: false,
  }
}

// buildGatErrorSet({ exams, name, names, buckets, absentExams, qSubject, cap })
//   exams       — the exams in scope, each with students[] carrying `responses`
//   names       — every spelling this student's results are filed under
//   buckets     — which verdicts to include (default: wrong + skipped)
//   absentExams — papers the student's batch sat that they have no result row
//                 in. Every question becomes an `absent` entry. Opt-in: an
//                 unattempted paper is not a mistake, and including it can
//                 double the document.
//   qSubject    — keep only this question subject. For a COMBINED paper, where
//                 one exam carries several subjects at question level; an
//                 exam-level subject filter belongs in errorSetSelect.js.
//   cap         — keep at most this many questions, most recent sitting first.
//                 0/blank means no cap. `totals.available` always reports the
//                 pre-cap count so the caller can say what was left out.
export function buildGatErrorSet({
  exams = [],
  name,
  names,
  buckets = GAT_BUCKETS,
  absentExams = [],
  qSubject = '',
  cap = 0,
} = {}) {
  const who = new Set((names && names.length ? names : [name]).filter(Boolean))
  const wanted = new Set(buckets)
  // Normalise the same way toQuestion does, or a filter on 'Others' would never
  // match the questions that landed there by defaulting.
  const subjectOf = q => q.subject || 'Others'
  const inSubject = q => !qSubject || subjectOf(q) === qSubject

  const flat = []
  let droppedNoText = 0

  exams.forEach(exam => {
    const student = (exam.students || []).find(s => who.has(s.name))
    if (!student) return
    ;(exam.questions || []).forEach(q => {
      const bucket = VERDICT[student.responses?.[q.q]]
      if (!bucket || !wanted.has(bucket)) return
      if (!inSubject(q)) return
      // A blank stem cannot be printed at a student. Count it so the gap is
      // visible on the cover rather than silently shrinking the set.
      if (!String(q.question || '').trim()) {
        droppedNoText += 1
        return
      }
      flat.push(toQuestion(q, exam, bucket))
    })
  })

  // Papers the student missed entirely: no result row, so no verdict to read —
  // every question counts, and the same blank-stem and subject rules apply.
  ;(absentExams || []).forEach(exam => {
    ;(exam.questions || []).forEach(q => {
      if (!inSubject(q)) return
      if (!String(q.question || '').trim()) {
        droppedNoText += 1
        return
      }
      flat.push(toQuestion(q, exam, 'absent'))
    })
  })

  // Collapse repeats onto their earliest sitting.
  flat.sort(byDateThenQ)
  const kept = []
  const seen = new Map()
  flat.forEach(q => {
    const key = stemKey(q.question)
    const first = seen.get(key)
    if (first) {
      first.repeats.push({ examName: q.examName, examDate: q.examDate, bucket: q.bucket })
      return
    }
    seen.set(key, q)
    kept.push(q)
  })

  // Cap AFTER the repeat collapse, so a question that appeared in three mocks
  // spends one slot rather than three. Ranked most recent first: a 900-error
  // pool has to be cut somewhere, and the freshest sittings are the ones the
  // student still remembers sitting.
  const available = kept.length
  const limit = Number(cap) > 0 ? Number(cap) : 0
  const selected = limit && available > limit
    ? [...kept].sort((a, b) => byDateThenQ(b, a)).slice(0, limit)
    : kept

  // Group: subject -> chapter -> context group.
  const subjectMap = new Map()
  selected.forEach(q => {
    if (!subjectMap.has(q.subject)) subjectMap.set(q.subject, new Map())
    const chapters = subjectMap.get(q.subject)
    if (!chapters.has(q.chapter)) chapters.set(q.chapter, [])
    chapters.get(q.chapter).push(q)
  })

  const countOf = qs => qs.reduce((acc, q) => {
    acc[q.bucket] += 1
    return acc
  }, { wrong: 0, skipped: 0, absent: 0 })

  const total = c => c.wrong + c.skipped + c.absent

  const subjects = [...subjectMap.entries()].map(([subject, chapterMap]) => {
    const chapters = [...chapterMap.entries()].map(([chapter, qs]) => {
      // Context groups first-class: questions with no Directions block lead,
      // then each block's questions together. Bucket order applies WITHIN a
      // group, not across it — splitting a passage to put every wrong answer
      // first would print the passage twice.
      const groups = new Map()
      qs.forEach(q => {
        const key = stemKey(q.context)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(q)
      })
      const ordered = [...groups.entries()]
        .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : 0))
        .flatMap(([key, group]) => {
          group.sort((x, y) =>
            BUCKET_ORDER.indexOf(x.bucket) - BUCKET_ORDER.indexOf(y.bucket) || byDateThenQ(x, y))
          if (key) group[0].showContext = true
          return group
        })
      return { chapter, counts: countOf(ordered), questions: ordered }
    })
    chapters.sort((a, b) => total(b.counts) - total(a.counts) || a.chapter.localeCompare(b.chapter))
    const counts = countOf(chapters.flatMap(c => c.questions))
    return { subject, counts, chapters }
  })
  subjects.sort((a, b) => total(b.counts) - total(a.counts) || a.subject.localeCompare(b.subject))

  // Sequential numbering across the whole document — the solutions section
  // keys off it, so it has to be assigned after every sort is settled.
  let n = 0
  const all = subjects.flatMap(s => s.chapters.flatMap(c => c.questions))
  all.forEach(q => { q.n = ++n })

  const counts = countOf(all)
  return {
    subjects,
    totals: {
      questions: n,
      available,
      counts,
      droppedNoText,
      missingSolution: all.filter(q => !q.solution).length,
      repeats: all.reduce((s, q) => s + q.repeats.length, 0),
      exams: new Set(all.map(q => q.examId)).size,
    },
  }
}
