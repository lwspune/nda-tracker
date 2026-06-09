// ── Exam-level insight functions ──────────────────────────────
// All functions operate directly on a single exam object.
// `names` param (optional Set<string>) scopes counts to a subset of students.
import { examMaxMarks } from '../analyticsHelpers'

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
