// ── Chapter & subtopic stats ──────────────────────────────────
import { stdDev } from '../analyticsHelpers'
import { getStudentExams } from './filters'

// Chapter-level stats across all exams (for dashboard heatmap)
// validNames: optional Set — when provided, only counts responses from those students
export function computeChapterStats(exams, validNames = null) {
  const stats = {}
  exams.forEach(exam => {
    const qMap = {}
    exam.questions.forEach(q => { qMap[q.q] = q })
    exam.students.forEach(s => {
      if (validNames && !validNames.has(s.name)) return
      Object.entries(s.responses || {}).forEach(([qn, resp]) => {
        const q = qMap[parseInt(qn)]
        if (!q) return
        if (!stats[q.chapter]) stats[q.chapter] = {}
        if (!stats[q.chapter][q.subtopic]) {
          stats[q.chapter][q.subtopic] = { correct: 0, wrong: 0, skipped: 0, total: 0 }
        }
        const sub = stats[q.chapter][q.subtopic]
        sub.total++
        if (resp === 1)  sub.correct++
        else if (resp === -1) sub.wrong++
        else sub.skipped++
      })
    })
  })
  return stats
}

// Per-student chapter/subtopic stats with recency weighting.
// qSubject: when set, only counts questions where q.subject matches (for GAT combined exams).
//           Questions with no q.subject (non-GAT exams) are always included.
export function computeStudentChapterStats(name, exams, qSubject = null) {
  const studentExams = getStudentExams(name, exams)
  if (!studentExams.length) return {}

  const result = {}
  const now = Date.now()

  studentExams.forEach(({ exam, student }) => {
    const qMap = {}
    exam.questions.forEach(q => { qMap[q.q] = q })
    const examDate = new Date(exam.date).getTime()
    const daysSince = (now - examDate) / (1000 * 60 * 60 * 24)
    // Recency weight: 1.0 for today, 0.5 for 30 days ago, min 0.2
    const weight = Math.max(0.2, 1 - (daysSince / 60))

    Object.entries(student.responses || {}).forEach(([qn, resp]) => {
      const q = qMap[parseInt(qn)]
      if (!q) return
      // For subject-filtered views: skip questions whose subject doesn't match.
      // q.subject=null means the question has no per-question subject (non-GAT exam) — always include.
      if (qSubject && q.subject && q.subject !== qSubject) return
      if (!result[q.chapter]) result[q.chapter] = {}
      if (!result[q.chapter][q.subtopic]) {
        result[q.chapter][q.subtopic] = {
          scores: [], weights: [], examsArr: [],
          correct: 0, wrong: 0, skipped: 0, total: 0,
        }
      }
      const sub = result[q.chapter][q.subtopic]
      sub.total++
      if (resp === 1) {
        sub.correct++
        sub.scores.push(1)
        sub.weights.push(weight)
      } else if (resp === -1) {
        sub.wrong++
        sub.scores.push(0)
        sub.weights.push(weight)
      } else {
        // Skipped — counts in total but not correct/wrong
        // Half weight: skipping is a weaker signal than attempting
        sub.skipped++
        sub.scores.push(0)
        sub.weights.push(weight * 0.5)
      }
    })

    // Track per-exam breakdown for subtopic accordion
    exam.questions.forEach(q => {
      if (qSubject && q.subject && q.subject !== qSubject) return
      if (!result[q.chapter]?.[q.subtopic]) return
      const sub = result[q.chapter][q.subtopic]
      const resp = student.responses?.[q.q]
      let existing = sub.examsArr.find(e => e.examId === exam.id)
      if (!existing) {
        existing = {
          examId: exam.id, date: exam.date, name: exam.name,
          correct: 0, wrong: 0, skipped: 0, total: 0
        }
        sub.examsArr.push(existing)
      }
      existing.total++
      if (resp === 1)  existing.correct++
      else if (resp === -1) existing.wrong++
      else existing.skipped++
    })
  })

  // Compute weighted scores and trends
  Object.values(result).forEach(subs => {
    Object.values(subs).forEach(sub => {
      // Weighted score. weightedSum / weightTotal are also kept so consumers can
      // pool questions across a chapter's subtopics (see computeProjectedScore)
      // instead of averaging each subtopic's ratio with an equal vote.
      const weightedSum = sub.scores.reduce((s, v, i) => s + v * sub.weights[i], 0)
      const weightTotal = sub.weights.reduce((s, v) => s + v, 0)
      sub.weightedSum   = weightedSum
      sub.weightTotal   = weightTotal
      sub.weightedScore = weightTotal > 0 ? weightedSum / weightTotal : 0

      // Attempt quality: correct / (correct + wrong) — excludes skips
      const attempted = sub.correct + sub.wrong
      sub.attemptQuality = attempted > 0 ? sub.correct / attempted : null

      // Trend from exam scores
      sub.trend = computeTrend(sub.examsArr.map(e =>
        e.total > 0 ? e.correct / e.total : 0
      ))

      sub.examsArr.sort((a, b) => a.date.localeCompare(b.date))
    })
  })

  return result
}

// Compute trend from array of scores
export function computeTrend(scores) {
  if (scores.length < 2) return 'stable'
  const last = scores[scores.length - 1]
  const prev = scores[scores.length - 2]
  const diff = last - prev
  if (scores.length >= 3) {
    const std = stdDev(scores)
    if (std > 0.2) return 'volatile'
  }
  if (diff > 0.1) return 'improving'
  if (diff < -0.1) return 'declining'
  return 'stable'
}
