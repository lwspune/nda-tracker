// ── Student record merge (deduplication) ─────────────────────

/**
 * Merges two student records into one. The primary record's scalar fields
 * are preserved; the secondary's name is added to the primary's name_variants.
 * Array fields are unioned and deduplicated. The secondary record is removed.
 *
 * After a merge, no changes to faculty-data.json exam results are needed —
 * the secondary's canonical_name in name_variants[] is enough for
 * matchStudents.js to route both names to the merged profile.
 *
 * Merge strategy per field:
 *   Scalar (lws_id, canonical_name, mobile, dob, gender, email, eis_reg_no,
 *           branch, registration_date, account_status, coming_status, quit_date):
 *     → primary wins
 *   name_variants:     union; secondary's canonical_name added
 *   evalbee_roll_nos:  union (dedup)
 *   match_signatures:  union (dedup)
 *   batches:           union (dedup)
 *   attendance:        union, dedup by date+batch (primary wins on conflict)
 *   exams:             union, dedup by exam_name+exam_date (primary wins)
 *   fees:              primary wins entirely
 *
 * @param {Array}  students        current students array (not mutated)
 * @param {string} primaryLwsId   lws_id of the record to keep
 * @param {string} secondaryLwsId lws_id of the record to remove
 * @returns {Array} updated students array
 */
export function mergeStudentRecords(students, primaryLwsId, secondaryLwsId) {
  const primary   = students.find(s => s.lws_id === primaryLwsId)
  const secondary = students.find(s => s.lws_id === secondaryLwsId)
  if (!primary || !secondary) return students

  const unionStrings = (a, b) => [...new Set([...(a || []), ...(b || [])])]

  // Attendance: dedup by date+batch key; primary wins conflict
  const mergeAttendance = (pa, sa) => {
    const seen = new Map()
    for (const r of (pa || [])) seen.set(`${r.date}|${r.batch || ''}`, r)
    for (const r of (sa || [])) {
      const k = `${r.date}|${r.batch || ''}`
      if (!seen.has(k)) seen.set(k, r)
    }
    return [...seen.values()]
  }

  // Exams: dedup by exam_name+exam_date; primary wins conflict
  const mergeExams = (pe, se) => {
    const seen = new Map()
    for (const r of (pe || [])) seen.set(`${r.exam_name}|${r.exam_date}`, r)
    for (const r of (se || [])) {
      const k = `${r.exam_name}|${r.exam_date}`
      if (!seen.has(k)) seen.set(k, r)
    }
    return [...seen.values()]
  }

  const secondaryNameVariants = [
    secondary.canonical_name,
    ...(secondary.name_variants || []),
  ].filter(Boolean)

  const merged = {
    ...primary,
    name_variants:    unionStrings(primary.name_variants, secondaryNameVariants),
    evalbee_roll_nos: unionStrings(primary.evalbee_roll_nos, secondary.evalbee_roll_nos),
    match_signatures: unionStrings(primary.match_signatures, secondary.match_signatures),
    batches:          unionStrings(primary.batches, secondary.batches),
    attendance:       mergeAttendance(primary.attendance, secondary.attendance),
    exams:            mergeExams(primary.exams, secondary.exams),
    // fees: primary wins — do not merge financial data automatically
  }

  return students
    .filter(s => s.lws_id !== secondaryLwsId)
    .map(s => s.lws_id === primaryLwsId ? merged : s)
}
