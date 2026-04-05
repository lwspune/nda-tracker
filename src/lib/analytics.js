// ============================================================
// ANALYTICS — pure functions only
// Input: raw data arrays. Output: computed values.
// No store access, no DOM, no side effects.
// ============================================================

// All unique student names across all exams
export function getAllStudents(exams) {
  const names = new Set()
  exams.forEach(e => e.students.forEach(s => names.add(s.name)))
  return [...names].sort()
}

// All exams a student appeared in, with their record
export function getStudentExams(name, exams) {
  return exams
    .map(exam => {
      const student = exam.students.find(s => s.name === name)
      return student ? { exam, student } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.exam.date.localeCompare(b.exam.date))
}

// Chapter-level stats across all exams (for dashboard heatmap)
export function computeChapterStats(exams) {
  const stats = {}
  exams.forEach(exam => {
    const qMap = {}
    exam.questions.forEach(q => { qMap[q.q] = q })
    exam.students.forEach(s => {
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

// Per-student chapter/subtopic stats with recency weighting
export function computeStudentChapterStats(name, exams) {
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
      // Weighted score
      const weightedSum = sub.scores.reduce((s, v, i) => s + v * sub.weights[i], 0)
      const weightTotal = sub.weights.reduce((s, v) => s + v, 0)
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

// Wrong Answer Audit — subtopics sorted by wrong answer count
export function computeWrongAudit(name, exams) {
  const chapterStats = computeStudentChapterStats(name, exams)
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

// Projected NDA score using chapter accuracy and frequency table
export function computeProjectedScore(name, exams, ndaFreq) {
  const chapterStats = computeStudentChapterStats(name, exams)
  const freqMap = {}
  ndaFreq.forEach(r => { freqMap[r.chapter.toLowerCase()] = r })

  let totalProjected = 0
  const breakdown = []

  ndaFreq.forEach(freq => {
    const marksAtStake = freq.pct * 3 // pct% of 300
    // Exact match only — chapter names are guaranteed consistent
    const chKey = Object.keys(chapterStats).find(
      k => k.toLowerCase() === freq.chapter.toLowerCase()
    )

    if (!chKey) {
      breakdown.push({ chapter: freq.chapter, marksAtStake, projected: 0, accuracy: null, wrongRate: null, gap: marksAtStake })
      return
    }

    const subs = chapterStats[chKey]

    // Use recency-weighted score per subtopic (same as chapter heatmap)
    // weightedScore already accounts for recency — recent exams weighted higher
    let weightedScoreSum = 0, weightedScoreCount = 0
    let totalWrong = 0, totalAttempted = 0

    Object.values(subs).forEach(s => {
      // Weighted accuracy — recency-aware
      weightedScoreSum += s.weightedScore
      weightedScoreCount++
      // Wrong rate uses raw counts — recency doesn't change the penalty ratio
      totalWrong += s.wrong
      totalAttempted += s.correct + s.wrong
    })

    const accuracy  = weightedScoreCount > 0 ? weightedScoreSum / weightedScoreCount : 0
    const wrongRate = totalAttempted > 0 ? totalWrong / totalAttempted : 0

    // Expected marks = accuracy × marksAtStake − wrongRate × marksAtStake × 0.33
    const projected = (accuracy * marksAtStake) - (wrongRate * marksAtStake * 0.33)
    const clamped = Math.max(0, projected)
    totalProjected += clamped

    breakdown.push({
      chapter: freq.chapter,
      marksAtStake,
      projected: clamped,
      accuracy,
      wrongRate,
      gap: marksAtStake - clamped,
    })
  })

  breakdown.sort((a, b) => b.gap - a.gap)
  return { total: Math.round(totalProjected), breakdown }
}

// At-risk students (weak in 2+ chapters)
export function getAtRisk(exams) {
  const students = getAllStudents(exams)
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
export function getHardestQuestions(exams, limit = 8) {
  const stats = []
  exams.forEach(exam => {
    exam.questions.forEach(q => {
      let correct = 0, total = 0
      exam.students.forEach(s => {
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

// Toppers — students above threshold sorted by projected score
export function getToppers(exams, ndaFreq, threshold = 0.7) {
  const students = getAllStudents(exams)
  return students
    .map(name => {
      const studentExams = getStudentExams(name, exams)
      const pcts = studentExams.map(({ exam, student }) => {
        const max = exam.questions.length * exam.marking.correct
        return max > 0 ? student.totalMarks / max : 0
      })
      const avgPct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0
      if (avgPct < threshold) return null
      const projected = computeProjectedScore(name, exams, ndaFreq)
      const aq = computeAttemptQuality(name, exams)
      const consistency = computeConsistency(name, exams)
      return { name, avgPct, projected: projected.total, attemptQuality: aq, consistency }
    })
    .filter(Boolean)
    .sort((a, b) => b.projected - a.projected)
}

// ── Helpers ──────────────────────────────────────────────────
function stdDev(arr) {
  if (arr.length < 2) return 0
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}

export function scoreColor(pct) {
  if (pct >= 0.7) return 'text-success'
  if (pct >= 0.45) return 'text-warning'
  return 'text-danger'
}

export function scoreBg(pct) {
  if (pct >= 0.7) return '#16a34a'
  if (pct >= 0.45) return '#d97706'
  return '#e03e3e'
}
