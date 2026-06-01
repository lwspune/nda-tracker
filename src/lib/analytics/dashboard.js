// ── Dashboard aggregates ──────────────────────────────────────
// Class-level, longitudinal and comparative metrics composed from the existing
// analytics primitives. These power the dashboard "command center" widgets:
//   - examAvgPct / getPerformanceSeries → performance-over-time trend + KPI deltas
//   - getClassProjectedAvg             → class projected-NDA-score KPI
//   - getPriorityChapters              → weak × high-yield teaching priorities
//   - getBatchComparison               → side-by-side per-batch metrics
//
// All functions are pure. %-of-max (score / (questions.length × marking.correct))
// is the only score unit used here — raw totalMarks is NOT comparable across exams
// with different paper sizes, which is why the old "Avg Score" KPI was meaningless.

import { getBatchOptions, getExamsForBatch } from './filters'
import { computeChapterStats } from './chapterStats'
import { getAtRisk } from './classMetrics'
import { getToppers } from './projection'

// Average %-of-max for a single exam, optionally scoped to a set of student names.
// Returns { avgPct (0..1), n (students scored), maxMarks }.
export function examAvgPct(exam, nameFilter = null) {
  const maxMarks = (exam.questions?.length || 0) * (exam.marking?.correct || 0)
  if (maxMarks <= 0) return { avgPct: 0, n: 0, maxMarks: 0 }

  const students = (exam.students || []).filter(s => !nameFilter || nameFilter.has(s.name))
  if (!students.length) return { avgPct: 0, n: 0, maxMarks }

  const sum = students.reduce((acc, s) => acc + (s.totalMarks || 0) / maxMarks, 0)
  return { avgPct: sum / students.length, n: students.length, maxMarks }
}

// Chronological class-average %-of-max, one point per exam (oldest → newest).
// nameFilter scopes every point to a subset of students (e.g. a batch or valid-name set).
// Exams with no scorable students (empty, or none match the filter) are dropped.
export function getPerformanceSeries(exams, nameFilter = null) {
  return (exams || [])
    .map(exam => {
      const { avgPct, n } = examAvgPct(exam, nameFilter)
      if (n === 0) return null
      return { examId: exam.id, name: exam.name, date: exam.date, subject: exam.subject || 'Maths', avgPct, n }
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

// Mean projected NDA score across all (optionally valid) students.
// Reuses getToppers with threshold 0 so regDate scoping + projection stay identical
// to the Toppers page. Returns { avg (rounded), count }.
export function getClassProjectedAvg(exams, ndaFreq, totalMarks = 300, opts = {}) {
  const scored = getToppers(exams, ndaFreq, 0, totalMarks, opts)
  if (!scored.length) return { avg: 0, count: 0 }
  const sum = scored.reduce((acc, s) => acc + s.projected, 0)
  return { avg: Math.round(sum / scored.length), count: scored.length }
}

// Weak × high-yield: cross the NDA chapter-weightage table with class accuracy.
// priority = weightPct × (1 − accuracy); untested chapters use accuracy 0 so a
// high-weight chapter the class hasn't been tested on still surfaces (tested=false).
// Only chapters present in ndaFreq are returned (the widget is weightage-driven).
// Sorted by priority desc, tiebreak weightPct desc.
export function getPriorityChapters(exams, ndaFreq, totalMarks = 300, opts = {}) {
  const { validNames = null } = opts
  const stats = computeChapterStats(exams, validNames)

  // chapter (lowercased) → { correct, total } aggregated across subtopics
  const acc = {}
  Object.entries(stats).forEach(([chapter, subs]) => {
    let correct = 0, total = 0
    Object.values(subs).forEach(s => { correct += s.correct; total += s.total })
    acc[chapter.toLowerCase()] = { correct, total }
  })

  return (ndaFreq || [])
    .map(freq => {
      const weightPct = parseFloat(freq.pct) || 0
      const marks = weightPct / 100 * totalMarks
      const a = acc[freq.chapter.toLowerCase()]
      const tested = !!a && a.total > 0
      const accuracy = tested ? a.correct / a.total : null
      const priority = weightPct * (1 - (accuracy ?? 0))
      return {
        chapter: freq.chapter,
        weightPct,
        marks,
        accuracy,
        correct: a?.correct ?? 0,
        total: a?.total ?? 0,
        tested,
        priority,
      }
    })
    .sort((x, y) => y.priority - x.priority || y.weightPct - x.weightPct)
}

// Collect the set of exam-record names (canonical + variants) for every profile
// whose batches[] includes the given batch. Variant-keyed profile entries are
// skipped (p.name === key) so each student is counted once.
function batchMemberNames(studentProfiles, batch) {
  const names = new Set()
  Object.entries(studentProfiles || {}).forEach(([key, p]) => {
    if (!p || p.name !== key) return
    if (!(p.batches || []).includes(batch)) return
    names.add(p.name)
    ;(p.nameVariants || []).forEach(v => v && names.add(v))
  })
  return names
}

// Per-batch comparison table. One row per batch (from getBatchOptions), each
// metric scoped to that batch's members. Sorted by avgPct ascending so the batch
// that needs attention is first. Syllabus pace is intentionally omitted (v1).
export function getBatchComparison(exams, studentProfiles, ndaFreq, totalMarks = 300) {
  const batches = getBatchOptions(exams, studentProfiles)

  return batches
    .map(batch => {
      const names = batchMemberNames(studentProfiles, batch)
      const batchExams = getExamsForBatch(exams, studentProfiles, batch)

      const series = getPerformanceSeries(batchExams, names)
      const avgPct = series.length
        ? series.reduce((a, p) => a + p.avgPct, 0) / series.length
        : 0

      const { avg: projected } = getClassProjectedAvg(batchExams, ndaFreq, totalMarks, { validNames: names })
      const atRisk = getAtRisk(batchExams, names).length

      return { batch, students: names.size, exams: batchExams.length, avgPct, projected, atRisk }
    })
    .sort((a, b) => a.avgPct - b.avgPct || a.batch.localeCompare(b.batch))
}
