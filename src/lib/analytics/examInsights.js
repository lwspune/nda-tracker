// ── Exam-level insight functions ──────────────────────────────
// All functions operate directly on a single exam object.
// `names` param (optional Set<string>) scopes counts to a subset of students.
import { examMaxMarks, stdDev } from '../analyticsHelpers'

/**
 * Top N students by score in a single exam.
 * @returns {Array<{name, score, pct}>}
 */
export function getExamTopStudents(exam, n = 5) {
  const maxMarks = examMaxMarks(exam)
  return [...exam.students]
    .sort((a, b) => b.totalMarks - a.totalMarks)
    .slice(0, n)
    .map(s => ({
      name:  s.name,
      score: s.totalMarks,
      pct:   maxMarks > 0 ? s.totalMarks / maxMarks : 0,
    }))
}

/**
 * Bottom N students by score in a single exam.
 * @returns {Array<{name, score, pct}>}
 */
export function getExamBottomStudents(exam, n = 5) {
  const maxMarks = examMaxMarks(exam)
  return [...exam.students]
    .sort((a, b) => a.totalMarks - b.totalMarks)
    .slice(0, n)
    .map(s => ({
      name:  s.name,
      score: s.totalMarks,
      pct:   maxMarks > 0 ? s.totalMarks / maxMarks : 0,
    }))
}

/**
 * Top N questions by wrong-answer count across all (or scoped) students.
 * @param {Set<string>|null} names  optional — restrict to these student names
 * @returns {Array<{q, wrong, total, wrongRate}>}
 */
export function getExamWrongQuestions(exam, names = null, n = 5) {
  return exam.questions
    .map(q => {
      let wrong = 0, total = 0
      exam.students.forEach(s => {
        if (names && !names.has(s.name)) return
        const r = s.responses?.[q.q]
        if (r !== undefined) { total++; if (r === -1) wrong++ }
      })
      return { q, wrong, total, wrongRate: total > 0 ? wrong / total : 0 }
    })
    .filter(x => x.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong)
    .slice(0, n)
}

/**
 * Top N questions by unattempted count across all (or scoped) students.
 * @param {Set<string>|null} names  optional — restrict to these student names
 * @returns {Array<{q, skipped, total, skipRate}>}
 */
export function getExamSkippedQuestions(exam, names = null, n = 5) {
  return exam.questions
    .map(q => {
      let skipped = 0, total = 0
      exam.students.forEach(s => {
        if (names && !names.has(s.name)) return
        const r = s.responses?.[q.q]
        if (r !== undefined) { total++; if (r === 0) skipped++ }
      })
      return { q, skipped, total, skipRate: total > 0 ? skipped / total : 0 }
    })
    .filter(x => x.skipped > 0)
    .sort((a, b) => b.skipped - a.skipped)
    .slice(0, n)
}

/**
 * Top 25% (or topPct) of students in a single exam by score.
 * Minimum 1 topper even when the class is tiny.
 *
 * @param {number} topPct  fraction of students to include (default 0.25)
 * @returns {{ toppers: Array<student>, names: Set<string>, count: number, cutoffScore: number }}
 */
/**
 * Whole-class shape of a single exam's marks.
 *
 * Written papers carry no per-question data, so the only thing that can be said
 * about one beyond min/avg/max is how the marks are spread. Median matters more
 * than mean here: class tests are small, and one runaway score drags the mean to
 * a value nobody sat.
 *
 * Bands reuse the thresholds `scoreColor` already applies everywhere else
 * (>=70% / >=45% / below), so a band carries the same meaning as the colours on
 * the rest of the page rather than inventing a second grading vocabulary.
 *
 * @returns {{count, maxMarks, min, max, mean, median, spread,
 *            meanPct, medianPct, bands: {strong, fair, weak}|null}}
 *          Marks-based fields are null for an empty class; percentage fields and
 *          bands are null when the paper ceiling is unusable (see examMaxMarks).
 */
export function getExamScoreSummary(exam) {
  const maxMarks = examMaxMarks(exam)
  const scores = (exam?.students ?? [])
    .map(s => Number(s?.totalMarks))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)

  const count = scores.length
  const scorable = maxMarks > 0
  const pct = v => (scorable && v !== null ? v / maxMarks : null)

  if (count === 0) {
    return {
      count: 0, maxMarks, min: null, max: null, mean: null, median: null, spread: 0,
      meanPct: null, medianPct: null,
      bands: scorable ? { strong: 0, fair: 0, weak: 0 } : null,
    }
  }

  const mean = scores.reduce((a, b) => a + b, 0) / count
  const mid  = Math.floor(count / 2)
  const median = count % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2

  let bands = null
  if (scorable) {
    bands = { strong: 0, fair: 0, weak: 0 }
    for (const v of scores) {
      const p = v / maxMarks
      if (p >= 0.7) bands.strong++
      else if (p >= 0.45) bands.fair++
      else bands.weak++
    }
  }

  return {
    count,
    maxMarks,
    min: scores[0],
    max: scores[count - 1],
    mean,
    median,
    spread: stdDev(scores),
    meanPct: pct(mean),
    medianPct: pct(median),
    bands,
  }
}

export function getExamToppers(exam, topPct = 0.25) {
  const sorted = [...exam.students].sort((a, b) => b.totalMarks - a.totalMarks)
  const count  = Math.max(1, Math.ceil(sorted.length * topPct))
  const toppers = sorted.slice(0, count)
  return {
    toppers,
    names:        new Set(toppers.map(s => s.name)),
    count,
    cutoffScore:  toppers[toppers.length - 1]?.totalMarks ?? 0,
  }
}
