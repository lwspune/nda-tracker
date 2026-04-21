// ── Per-student performance metrics & audits ─────────────────
import { stdDev } from '../analyticsHelpers'
import { getStudentExams } from './filters'
import { computeStudentChapterStats } from './chapterStats'

// Attempt Quality Score — correct / (correct + wrong) across all exams
export function computeAttemptQuality(name, exams) {
  let correct = 0, wrong = 0
  const studentExams = getStudentExams(name, exams)
  studentExams.forEach(({ student }) => {
    correct += student.correct || 0
    wrong += student.incorrect || 0
  })
  const attempted = correct + wrong
  return attempted > 0 ? correct / attempted : null
}

// Consistency Score — std deviation of % scores across exams (lower = more consistent)
export function computeConsistency(name, exams) {
  const studentExams = getStudentExams(name, exams)
  if (studentExams.length < 2) return null
  const pcts = studentExams.map(({ exam, student }) => {
    const max = exam.questions.length * exam.marking.correct
    return max > 0 ? student.totalMarks / max : 0
  })
  const sd = stdDev(pcts)
  // Label: Consistent < 0.1, Moderate 0.1–0.2, Volatile > 0.2
  if (sd < 0.1) return { sd, label: 'Consistent', color: 'success' }
  if (sd < 0.2) return { sd, label: 'Moderate', color: 'warning' }
  return { sd, label: 'Volatile', color: 'danger' }
}

// Unattempted Question Audit — subtopics sorted by skipped count
// qSubject: when set, only counts questions matching that subject (for GAT combined exams)
export function computeSkippedAudit(name, exams, qSubject = null) {
  const chapterStats = computeStudentChapterStats(name, exams, qSubject)
  const audit = []
  Object.entries(chapterStats).forEach(([chapter, subs]) => {
    Object.entries(subs).forEach(([subtopic, data]) => {
      if (data.skipped > 0) {
        audit.push({
          chapter,
          subtopic,
          skipped:  data.skipped,
          correct:  data.correct,
          wrong:    data.wrong,
          total:    data.total,
          skipRate: data.total > 0 ? data.skipped / data.total : 0,
        })
      }
    })
  })
  return audit.sort((a, b) => b.skipped - a.skipped)
}

// Wrong Answer Audit — subtopics sorted by wrong answer count
// qSubject: when set, only counts questions matching that subject (for GAT combined exams)
export function computeWrongAudit(name, exams, qSubject = null) {
  const chapterStats = computeStudentChapterStats(name, exams, qSubject)
  const audit = []
  Object.entries(chapterStats).forEach(([chapter, subs]) => {
    Object.entries(subs).forEach(([subtopic, data]) => {
      if (data.wrong > 0) {
        audit.push({
          chapter,
          subtopic,
          wrong: data.wrong,
          correct: data.correct,
          total: data.total,
          wrongRate: data.wrong / (data.correct + data.wrong) || 0,
        })
      }
    })
  })
  return audit.sort((a, b) => b.wrong - a.wrong)
}
