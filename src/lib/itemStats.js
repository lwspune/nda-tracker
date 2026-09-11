// What the answer sheets say about each BANK question.
//
// Every mock already records, per question, whether each student was right,
// wrong or absent from it — and which option they ticked. Until questionId
// existed that evidence died with the exam, because nothing tied an answer
// sheet back to the bank item. This pools it.
//
// Pure: takes the store's exams (questions[] + students[]) and returns rows.
// No fetch, no DB — the client already loads responses AND choices for every
// exam, so nothing new is read.
//
// Full rationale + the measurements behind the thresholds: ITEM_STATS.md

const LABELS = ['A', 'B', 'C', 'D']

// Classic item-analysis split. The top and bottom 27% of a sitting maximise the
// contrast between strong and weak students while keeping both groups large
// enough to mean something.
const EXTREME_GROUP = 0.27

function emptyCounts() {
  return { A: 0, B: 0, C: 0, D: 0 }
}

/**
 * @param {Array} exams  store exams: { id, name, questions[], students[] }
 * @param {{minAttempts?: number}} opts
 * @returns {{rows: Array, keyConflicts: Array}}
 *
 * Rows are ranked worst-first by `distractorRatio` — the review queue, because
 * that is the list with actions in it. A high ratio is a LEAD, never a verdict:
 * a distractor outpulls the key when the key is wrong, AND when the question is
 * hard and the trap is well built. Only a human reading the question can say.
 */
export function computeItemStats(exams, { minAttempts = 20 } = {}) {
  const acc = new Map()

  for (const exam of exams || []) {
    const questions = (exam && exam.questions) || []
    if (!questions.length) continue                     // written quiz: nothing per-question
    const students = exam.students || []

    // Ability groups for THIS sitting only. Batches differ, so a ranking across
    // records would confuse a weaker student with a weaker cohort.
    const ranked = students
      .filter(s => typeof s.totalMarks === 'number')
      .slice()
      .sort((a, b) => b.totalMarks - a.totalMarks)
    const groupSize = Math.floor(ranked.length * EXTREME_GROUP)
    const upper = new Set(ranked.slice(0, groupSize))
    const lower = new Set(ranked.slice(ranked.length - groupSize))

    for (const question of questions) {
      const id = question && question.questionId
      if (!id) continue

      if (!acc.has(id)) {
        acc.set(id, {
          questionId: id,
          chapter: question.chapter ?? null,
          subtopic: question.subtopic ?? null,
          subject: question.subject ?? exam.subject ?? null,
          question: question.question ?? null,
          // The whole question as first seen, so a reviewer can be shown the
          // OPTIONS and the SOLUTION. A key cannot be judged from the stem.
          // Pooled copies are the same bank question, so the first will do.
          source: question,
          keys: new Map(),           // answer -> {examId, examName, answer}
          seen: 0, attempted: 0, skipped: 0, correct: 0, wrong: 0,
          choiceCounts: emptyCounts(),
          upperSeen: 0, upperCorrect: 0, lowerSeen: 0, lowerCorrect: 0,
          exams: new Map(),
        })
      }
      const row = acc.get(id)
      row.exams.set(exam.id, { id: exam.id, name: exam.name, date: exam.date })

      const answer = question.answer ? String(question.answer).toUpperCase() : null
      if (answer && !row.keys.has(answer)) {
        row.keys.set(answer, { examId: exam.id, examName: exam.name, answer })
      }

      const qn = String(question.q)
      for (const s of students) {
        const verdict = (s.responses || {})[qn]
        if (verdict === undefined || verdict === null) continue   // not on this sheet
        row.seen += 1
        if (verdict === 0) { row.skipped += 1; continue }

        row.attempted += 1
        if (verdict === 1) row.correct += 1
        else row.wrong += 1

        // The chosen letter is meaningful only for an attempt: a skip says
        // nothing about which option pulls.
        const chose = (s.choices || {})[qn]
        const label = chose ? String(chose).toUpperCase() : null
        if (label && LABELS.includes(label)) row.choiceCounts[label] += 1

        if (upper.has(s)) { row.upperSeen += 1; if (verdict === 1) row.upperCorrect += 1 }
        else if (lower.has(s)) { row.lowerSeen += 1; if (verdict === 1) row.lowerCorrect += 1 }
      }
    }
  }

  const rows = []
  const keyConflicts = []

  for (const row of acc.values()) {
    const keys = [...row.keys.values()]

    // Keyed differently in two sittings: one of them is wrong, and averaging
    // two notions of "correct" would bury that. A finding, not an input.
    if (keys.length > 1) {
      keyConflicts.push({
        questionId: row.questionId, chapter: row.chapter,
        subject: row.subject, question: row.question, source: row.source, keys,
      })
      continue
    }
    const keyed = keys.length === 1 ? keys[0].answer : null

    const choseKey = keyed ? row.choiceCounts[keyed] : 0
    let topDistractor = null
    for (const label of LABELS) {
      if (label === keyed) continue
      const n = row.choiceCounts[label]
      if (n > 0 && (!topDistractor || n > topDistractor.n)) topDistractor = { label, n }
    }

    rows.push({
      questionId: row.questionId,
      chapter: row.chapter,
      subtopic: row.subtopic,
      subject: row.subject,
      question: row.question,
      source: row.source,
      keyed,
      seen: row.seen,
      attempted: row.attempted,
      skipped: row.skipped,
      correct: row.correct,
      wrong: row.wrong,
      // Over ATTEMPTED, never over seen: mixing in skips makes an easy but
      // widely-avoided question read as a hard one. Skipping gets its own number.
      pCorrect: row.attempted ? row.correct / row.attempted : null,
      skipRate: row.seen ? row.skipped / row.seen : null,
      choiceCounts: row.choiceCounts,
      topDistractor,
      // null, not Infinity, when nobody picked the key — "no ratio exists" is
      // not "infinitely bad", and a sort must not float it above real evidence.
      distractorRatio: topDistractor && choseKey > 0 ? topDistractor.n / choseKey : null,
      discrimination: row.upperSeen && row.lowerSeen
        ? row.upperCorrect / row.upperSeen - row.lowerCorrect / row.lowerSeen
        : null,
      exams: [...row.exams.values()],
      insufficient: row.attempted < minAttempts,
    })
  }

  rows.sort((a, b) => (b.distractorRatio ?? -1) - (a.distractorRatio ?? -1))
  return { rows, keyConflicts }
}
