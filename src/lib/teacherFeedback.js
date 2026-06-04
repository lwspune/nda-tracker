// Pure helpers for the teacher-feedback flow (superadmin-only).
// The Google Form is "wide": Timestamp + one repeated 9-column block per teacher
// (8 rating dimensions in a fixed order + 1 open-text comment). The block headers
// are generic ("The teacher explains…"), so the teacher identity is supplied at
// import time as a block→name mapping. These helpers reshape that wide matrix into
// one row per (response, teacher) and aggregate it for the UI.

export const FEEDBACK_DIMENSIONS = [
  { key: 'clarity',      label: 'Clarity' },
  { key: 'engagement',   label: 'Engagement' },
  { key: 'support',      label: 'Support' },
  { key: 'feedback',     label: 'Feedback' },
  { key: 'pace',         label: 'Pace' },
  { key: 'respect',      label: 'Respect' },
  { key: 'organization', label: 'Organization' },
  { key: 'availability', label: 'Availability' },
]

const DIM_KEYS = FEEDBACK_DIMENSIONS.map(d => d.key)
const BLOCK_WIDTH = DIM_KEYS.length + 1 // 8 ratings + 1 comment

// Block starts are the header cells beginning with "Clarity" (one per teacher).
// Robust to a leading Timestamp column and any trailing columns.
export function detectBlockStarts(headerRow) {
  if (!Array.isArray(headerRow)) return []
  const starts = []
  headerRow.forEach((h, i) => {
    if (typeof h === 'string' && /^\s*clarity\b/i.test(h)) starts.push(i)
  })
  return starts
}

// "30/05/2026 16:40:37" → "2026-05-30T16:40:37+05:30" (IST). Returns null if
// unparseable. Accepts a missing time component.
export function parseFormTimestamp(s) {
  if (!s) return null
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m
  const p = (v, n) => String(v).padStart(n, '0')
  return `${yyyy}-${p(mm, 2)}-${p(dd, 2)}T${p(hh, 2)}:${p(mi, 2)}:${p(ss, 2)}+05:30`
}

function toRating(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null
}

// Reshape the wide matrix into per-(response, teacher) rows.
// - matrix: array of arrays; matrix[0] = header row, matrix[1..] = data rows.
// - teacherNames: array indexed by block (0-based). A block whose name is empty/
//   undefined is skipped entirely (e.g. an unmapped column group).
// - opts: { cycle, branch }.
// A (row, block) pair is dropped when every rating is null AND the comment is
// blank (an unfilled block — e.g. a teacher added to the form partway through).
export function reshapeFeedbackMatrix(matrix, teacherNames, { cycle, branch } = {}) {
  if (!Array.isArray(matrix) || matrix.length < 2) return []
  const header = matrix[0]
  const starts = detectBlockStarts(header)
  const out = []

  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r]
    if (!Array.isArray(row)) continue
    const submitted_at = parseFormTimestamp(row[0])

    starts.forEach((start, blockIdx) => {
      const teacher_name = (teacherNames?.[blockIdx] || '').trim()
      if (!teacher_name) return

      const ratings = {}
      let anyRating = false
      DIM_KEYS.forEach((key, j) => {
        const v = toRating(row[start + j])
        ratings[key] = v
        if (v !== null) anyRating = true
      })
      const comment = String(row[start + DIM_KEYS.length] ?? '').trim()
      if (!anyRating && !comment) return // unfilled block

      out.push({ cycle, branch, submitted_at, teacher_name, ...ratings, comment: comment || null })
    })
  }
  return out
}

const round2 = n => Math.round(n * 100) / 100

// Per-teacher aggregates from feedback rows. Returns sorted worst-first is NOT
// imposed here — callers sort. overall = mean of all non-null dimension values.
export function aggregateFeedback(rows) {
  if (!Array.isArray(rows)) return []
  const byTeacher = new Map()
  for (const row of rows) {
    const name = row.teacher_name
    if (!name) continue
    if (!byTeacher.has(name)) {
      byTeacher.set(name, {
        teacher: name,
        n: 0,
        dimSums: Object.fromEntries(DIM_KEYS.map(k => [k, { sum: 0, count: 0 }])),
        comments: [],
      })
    }
    const agg = byTeacher.get(name)
    agg.n += 1
    for (const key of DIM_KEYS) {
      const v = row[key]
      if (typeof v === 'number') { agg.dimSums[key].sum += v; agg.dimSums[key].count += 1 }
    }
    if (row.comment && row.comment.trim()) {
      agg.comments.push({ comment: row.comment.trim(), submitted_at: row.submitted_at, cycle: row.cycle })
    }
  }

  return [...byTeacher.values()].map(agg => {
    const dims = {}
    let totalSum = 0, totalCount = 0
    for (const key of DIM_KEYS) {
      const { sum, count } = agg.dimSums[key]
      dims[key] = count ? round2(sum / count) : null
      totalSum += sum; totalCount += count
    }
    return {
      teacher: agg.teacher,
      n: agg.n,
      overall: totalCount ? round2(totalSum / totalCount) : null,
      dims,
      comments: agg.comments,
    }
  })
}

// Per-teacher overall score per cycle, for the trend view.
// → [{ teacher, cycles: [{ cycle, overall, n }] }]
export function feedbackTrend(rows) {
  if (!Array.isArray(rows)) return []
  const byTeacherCycle = new Map()
  for (const row of rows) {
    const key = `${row.teacher_name}|||${row.cycle ?? ''}`
    if (!byTeacherCycle.has(key)) byTeacherCycle.set(key, { teacher: row.teacher_name, cycle: row.cycle ?? '', sum: 0, count: 0, n: 0 })
    const e = byTeacherCycle.get(key)
    e.n += 1
    for (const k of DIM_KEYS) {
      const v = row[k]
      if (typeof v === 'number') { e.sum += v; e.count += 1 }
    }
  }
  const byTeacher = new Map()
  for (const e of byTeacherCycle.values()) {
    if (!byTeacher.has(e.teacher)) byTeacher.set(e.teacher, [])
    byTeacher.get(e.teacher).push({ cycle: e.cycle, overall: e.count ? round2(e.sum / e.count) : null, n: e.n })
  }
  return [...byTeacher.entries()].map(([teacher, cycles]) => ({
    teacher,
    cycles: cycles.sort((a, b) => String(a.cycle).localeCompare(String(b.cycle))),
  }))
}
