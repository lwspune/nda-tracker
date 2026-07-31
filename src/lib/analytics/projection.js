// ── Projected score & toppers ─────────────────────────────────
import { filterValidExams, getAllStudents, getStudentExams } from './filters'
import { computeStudentChapterStats } from './chapterStats'
import { computeAttemptQuality, computeConsistency } from './performance'
import { examMaxMarks } from '../analyticsHelpers'
import { getSubtopicShares } from '../ndaSubtopics'

// Expected marks from an accuracy + wrong-rate against a marks pool. Shared by
// the chapter and subtopic passes so the two levels cannot drift apart.
function expectedMarks(marksAtStake, accuracy, wrongRate) {
  return Math.max(0, accuracy * marksAtStake - wrongRate * marksAtStake * 0.33)
}

// Projected NDA score using chapter accuracy and frequency table.
// totalMarks: the subject's NDA paper ceiling (e.g. 300 for Maths, 200 for English).
// Defaults to 300 for backward compatibility.
//
// opts.withSubtopics — also return `subtopicBreakdown`, a FLAT cross-chapter list
// ranked by recoverable marks, plus `subtopicsUncovered` (chapters with no
// taxonomy entry). Opt-in on purpose: getToppers calls this once per student, and
// building + sorting 111 subtopic rows per topper is wasted work. The chapter
// maths and `total` are identical either way.
export function computeProjectedScore(name, exams, ndaFreq, totalMarks = 300, opts = {}) {
  const { withSubtopics = false } = opts
  const chapterStats = computeStudentChapterStats(name, exams)
  const freqMap = {}
  ndaFreq.forEach(r => { freqMap[r.chapter.toLowerCase()] = r })

  let totalProjected = 0
  const breakdown = []
  const subtopicBreakdown = []
  const subtopicsUncovered = []

  // One chapter's subtopic rows. `subs` is the student's per-subtopic stats for
  // that chapter, or null when the chapter was never tested — in which case every
  // subtopic is untested rather than absent, so the marks at stake stay visible.
  const addSubtopicRows = (chapter, chapterMarks, subs) => {
    const shares = getSubtopicShares(chapter)
    if (!shares.length) {
      subtopicsUncovered.push(chapter)
      return
    }
    shares.forEach(({ subtopic, share, pctHard }) => {
      const marksAtStake = chapterMarks * share / 100
      const key = subs && Object.keys(subs).find(k => k.toLowerCase() === subtopic.toLowerCase())
      const s = key ? subs[key] : null

      if (!s || s.total === 0) {
        subtopicBreakdown.push({
          chapter, subtopic, marksAtStake, projected: 0, gap: marksAtStake,
          accuracy: null, wrongRate: null, pctHard,
          n: 0, correct: 0, wrong: 0, skipped: 0,
        })
        return
      }

      const accuracy  = s.weightTotal > 0 ? s.weightedSum / s.weightTotal : 0
      const attempted = s.correct + s.wrong
      const wrongRate = attempted > 0 ? s.wrong / attempted : 0
      const projected = expectedMarks(marksAtStake, accuracy, wrongRate)

      subtopicBreakdown.push({
        chapter, subtopic, marksAtStake, projected, gap: marksAtStake - projected,
        accuracy, wrongRate, pctHard,
        n: s.total, correct: s.correct, wrong: s.wrong, skipped: s.skipped,
      })
    })
  }

  ndaFreq.forEach(freq => {
    const marksAtStake = (parseFloat(freq.pct) || 0) / 100 * totalMarks
    // Exact match only — chapter names are guaranteed consistent
    const chKey = Object.keys(chapterStats).find(
      k => k.toLowerCase() === freq.chapter.toLowerCase()
    )

    if (!chKey) {
      breakdown.push({ chapter: freq.chapter, marksAtStake, projected: 0, accuracy: null, wrongRate: null, gap: marksAtStake })
      if (withSubtopics) addSubtopicRows(freq.chapter, marksAtStake, null)
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
    const clamped = expectedMarks(marksAtStake, accuracy, wrongRate)
    totalProjected += clamped

    breakdown.push({
      chapter: freq.chapter,
      marksAtStake,
      projected: clamped,
      accuracy,
      wrongRate,
      gap: marksAtStake - clamped,
    })

    if (withSubtopics) addSubtopicRows(freq.chapter, marksAtStake, subs)
  })

  breakdown.sort((a, b) => b.gap - a.gap)
  const result = { total: Math.round(totalProjected), breakdown }
  if (withSubtopics) {
    // Flat and cross-chapter — the ranking question is "which subtopic anywhere
    // is worth the most", not "which subtopic within this chapter".
    subtopicBreakdown.sort((a, b) => b.gap - a.gap)
    result.subtopicBreakdown = subtopicBreakdown
    result.subtopicsUncovered = subtopicsUncovered
  }
  return result
}

// Toppers — students whose PROJECTED score meets the threshold, sorted by projected.
// threshold:             minimum projected marks (absolute, same scale as totalMarks).
//                        0 = no floor (return every scored student — the Dashboard's
//                        getClassProjectedAvg relies on this). Gate is `>=`.
// opts.validNames:       Set<string> — when provided, only considers those students
// opts.studentProfiles:  camelCase profile map — when provided, each student's exams are
//                        filtered to those on/after their regDate before scoring
export function getToppers(exams, ndaFreq, threshold = 0, totalMarks = 300, opts = {}) {
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
      // avgPct is no longer the gate — kept for the card's "avg %" chip + sort option.
      const avgPct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0

      const projected = computeProjectedScore(name, scopedExams, ndaFreq, totalMarks)
      if (projected.total < threshold) return null   // gate on projected marks

      const aq          = computeAttemptQuality(name, scopedExams)
      const consistency = computeConsistency(name, scopedExams)
      return { name, avgPct, projected: projected.total, attemptQuality: aq, consistency }
    })
    .filter(Boolean)
    .sort((a, b) => b.projected - a.projected)
}
