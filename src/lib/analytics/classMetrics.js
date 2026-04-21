// ── Class-level aggregation metrics ──────────────────────────
import { getAllStudents } from './filters'
import { computeStudentChapterStats } from './chapterStats'

// At-risk students (weak in 2+ chapters)
// validNames: optional Set — when provided, only considers those students
export function getAtRisk(exams, validNames = null) {
  const students = getAllStudents(exams, validNames)
  return students
    .map(name => {
      const cs = computeStudentChapterStats(name, exams)
      const weakChapters = Object.entries(cs)
        .filter(([, subs]) => {
          const vals = Object.values(subs)
          return vals.reduce((s, v) => s + v.weightedScore, 0) / vals.length < 0.5
        })
        .map(([ch]) => ch)
      return { name, weakChapters, count: weakChapters.length }
    })
    .filter(s => s.count >= 2)
    .sort((a, b) => b.count - a.count)
}

// Hardest questions (lowest class score)
// validNames: optional Set — when provided, only counts responses from those students
export function getHardestQuestions(exams, limit = 8, validNames = null) {
  const stats = []
  exams.forEach(exam => {
    exam.questions.forEach(q => {
      let correct = 0, total = 0
      exam.students.forEach(s => {
        if (validNames && !validNames.has(s.name)) return
        const r = s.responses?.[q.q]
        if (r !== undefined) { total++; if (r === 1) correct++ }
      })
      if (total > 0) stats.push({
        q: q.q, chapter: q.chapter, subtopic: q.subtopic,
        examName: exam.name, correct, total,
        pct: correct / total
      })
    })
  })
  return stats.sort((a, b) => a.pct - b.pct).slice(0, limit)
}
