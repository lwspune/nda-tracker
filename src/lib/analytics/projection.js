// ── Projected score & toppers ─────────────────────────────────
import { filterValidExams, getAllStudents, getStudentExams } from './filters'
import { computeStudentChapterStats } from './chapterStats'
import { computeAttemptQuality, computeConsistency } from './performance'
import { examMaxMarks } from '../analyticsHelpers'

// Projected NDA score using chapter accuracy and frequency table.
// totalMarks: the subject's NDA paper ceiling (e.g. 300 for Maths, 200 for English).
// Defaults to 300 for backward compatibility.
export function computeProjectedScore(name, exams, ndaFreq, totalMarks = 300) {
  const chapterStats = computeStudentChapterStats(name, exams)
  const freqMap = {}
  ndaFreq.forEach(r => { freqMap[r.chapter.toLowerCase()] = r })

  let totalProjected = 0
  const breakdown = []

  ndaFreq.forEach(freq => {
    const marksAtStake = (parseFloat(freq.pct) || 0) / 100 * totalMarks
    // Exact match only — chapter names are guaranteed consistent
    const chKey = Object.keys(chapterStats).find(
      k => k.toLowerCase() === freq.chapter.toLowerCase()
    )

    if (!chKey) {
      breakdown.push({ chapter: freq.chapter, marksAtStake, projected: 0, accuracy: null, wrongRate: null, gap: marksAtStake })
      return
    }

    const subs = chapterStats[chKey]

    // Pool every question in the chapter into one recency-weighted accuracy
    // (Σ score×weight / Σ weight). We deliberately do NOT average the per-subtopic
    // ratios — that gave a 1-question subtopic the same vote as a 20-question one.
    // weightedSum/weightTotal already fold in recency + the skip half-weight.
    let weightedSum = 0, weightTotal = 0
    let totalWrong = 0, totalAttempted = 0

    Object.values(subs).forEach(s => {
      weightedSum += s.weightedSum
      weightTotal += s.weightTotal
      // Wrong rate uses raw counts — recency doesn't change the penalty ratio
      totalWrong += s.wrong
      totalAttempted += s.correct + s.wrong
    })

    const accuracy  = weightTotal > 0 ? weightedSum / weightTotal : 0
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

// Toppers — students above threshold sorted by projected score
// opts.validNames:       Set<string> — when provided, only considers those students
// opts.studentProfiles:  camelCase profile map — when provided, each student's exams are
//                        filtered to those on/after their regDate before scoring
export function getToppers(exams, ndaFreq, threshold = 0.7, totalMarks = 300, opts = {}) {
  const { validNames, studentProfiles: profiles } = opts

  // Build case-insensitive name → profile map for regDate lookups
  const profileMap = {}
  if (profiles) {
    Object.values(profiles).forEach(p => {
      if (p.name) profileMap[p.name.toLowerCase()] = p
      ;(p.nameVariants || []).forEach(v => { if (v) profileMap[v.toLowerCase()] = p })
    })
  }

  const students = getAllStudents(exams, validNames)
  return students
    .map(name => {
      const allStudentExams = getStudentExams(name, exams)

      // Filter to post-registration exams when a profile with regDate is available
      const profile = profiles
        ? (profiles[name] || profileMap[name.toLowerCase()])
        : null
      const studentExams = profile?.regDate
        ? filterValidExams(allStudentExams, profile.regDate)
        : allStudentExams

      if (!studentExams.length) return null

      // Scope the full exam list to just the valid exams for this student so that
      // all analytics helpers (which call getStudentExams internally) see only them
      const validExamIds = new Set(studentExams.map(({ exam }) => exam.id))
      const scopedExams  = exams.filter(e => validExamIds.has(e.id))

      const pcts = studentExams.map(({ exam, student }) => {
        const max = examMaxMarks(exam)
        return max > 0 ? student.totalMarks / max : 0
      })
      const avgPct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0
      if (avgPct < threshold) return null

      const projected   = computeProjectedScore(name, scopedExams, ndaFreq, totalMarks)
      const aq          = computeAttemptQuality(name, scopedExams)
      const consistency = computeConsistency(name, scopedExams)
      return { name, avgPct, projected: projected.total, attemptQuality: aq, consistency }
    })
    .filter(Boolean)
    .sort((a, b) => b.projected - a.projected)
}
