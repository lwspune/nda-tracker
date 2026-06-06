// ── Registration-date helpers + student list queries ──────────

/**
 * Filters a getStudentExams() result to only exams on or after the student's
 * registration date. Returns the full array unchanged when regDate is falsy.
 *
 * @param {Array<{exam, student}>} studentExams  output of getStudentExams()
 * @param {string|null} regDate                  'YYYY-MM-DD' or null/''
 * @returns {Array<{exam, student}>}
 */
export function filterValidExams(studentExams, regDate) {
  if (!regDate) return studentExams
  return studentExams.filter(({ exam }) => exam.date >= regDate)
}

/**
 * Returns a Set of exam-record student names whose matched studentProfile has a
 * non-empty regDate — i.e. the set of "valid" students for class-level analytics.
 *
 * Matching uses:
 *   1. Direct key lookup in studentProfiles (profiles are indexed by name + variants)
 *   2. Case-insensitive fallback against canonical name and nameVariants[]
 *
 * @param {Array}  exams           all exam objects
 * @param {Object} studentProfiles camelCase profile map from the store
 * @returns {Set<string>}          exam-record names (as they appear in exam data)
 */
export function getValidStudentNames(exams, studentProfiles) {
  if (!studentProfiles || !Object.keys(studentProfiles).length) return new Set()

  // Build case-insensitive lookup: lowercase name/variant → profile
  const lowerMap = {}
  Object.values(studentProfiles).forEach(p => {
    if (p.name) lowerMap[p.name.toLowerCase()] = p
    ;(p.nameVariants || []).forEach(v => { if (v) lowerMap[v.toLowerCase()] = p })
  })

  const validNames = new Set()
  exams.forEach(e => e.students.forEach(s => {
    if (validNames.has(s.name)) return  // already confirmed
    const profile = studentProfiles[s.name] || lowerMap[s.name.toLowerCase()]
    if (profile?.regDate) validNames.add(s.name)
  }))
  return validNames
}

// All unique student names across all exams, optionally scoped to a valid-name set
export function getAllStudents(exams, validNames = null) {
  const names = new Set()
  exams.forEach(e => e.students.forEach(s => {
    if (validNames && !validNames.has(s.name)) return
    names.add(s.name)
  }))
  return [...names].sort()
}

// Build name→profile lookup covering canonical name + nameVariants
function buildProfileLookup(studentProfiles) {
  const map = {}
  Object.values(studentProfiles).forEach(p => {
    if (p.name) map[p.name] = p
    ;(p.nameVariants || []).forEach(v => { if (v) map[v] = p })
  })
  return map
}

// Parses an exam's batch field into a string[] of trimmed central batch names.
// `exam.batch` is stored comma-joined when an exam was sat by multiple batches
// (single batch is just the bare name with no comma).
export function getExamBatches(exam) {
  if (!exam || !exam.batch) return []
  return String(exam.batch)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

// Returns absentees for an exam — profiles whose batches[] intersect exam.batches
// (the central tag set) but whose canonical name (or any name_variant) does NOT
// appear in exam.students[]. Used to drive the exam-absence WhatsApp flow.
//
// `studentProfiles` is the canonical map keyed by name; entries keyed by a variant
// are filtered out by `p.name === key`, so each profile contributes at most once.
export function getExamAbsentees(exam, studentProfiles) {
  if (!studentProfiles) return []
  const examBatches = getExamBatches(exam)
  if (examBatches.length === 0) return []

  const examBatchSet = new Set(examBatches)
  const attendeeNamesLower = new Set(
    (exam.students || []).map(s => (s.name || '').toLowerCase().trim()).filter(Boolean)
  )

  const absentees = []
  for (const [key, p] of Object.entries(studentProfiles)) {
    if (!p || p.name !== key) continue              // skip variant-keyed entries
    if (p.accountStatus !== 'Active') continue      // skip Block / quit / batch-over / legacy
    if (p.regDate && exam.date && exam.date < p.regDate) continue  // not yet enrolled
    const batches = p.batches || []
    if (!batches.some(b => examBatchSet.has(b))) continue

    const nameLower = (p.name || '').toLowerCase().trim()
    const variantSet = (p.nameVariants || []).map(v => (v || '').toLowerCase().trim())
    const present = attendeeNamesLower.has(nameLower) || variantSet.some(v => attendeeNamesLower.has(v))
    if (present) continue

    absentees.push(p)
  }
  return absentees
}

// Unique batch options for a set of exams, derived primarily from profile.batches[].
// Falls back to exam.batch only for exams where no student has a profile.
export function getBatchOptions(exams, studentProfiles) {
  const lookup = buildProfileLookup(studentProfiles)
  const batches = new Set()
  exams.forEach(e => {
    let anyProfiled = false
    e.students.forEach(s => {
      const profile = lookup[s.name]
      if (profile) {
        anyProfiled = true
        ;(profile.batches || []).forEach(b => batches.add(b))
      }
    })
    if (!anyProfiled && e.batch) batches.add(e.batch)
  })
  return [...batches].sort()
}

// Filter exams to those where at least one student has batchName in profile.batches[].
// Falls back to exam.batch for exams where no student has a profile.
export function getExamsForBatch(exams, studentProfiles, batchName) {
  const lookup = buildProfileLookup(studentProfiles)
  return exams.filter(e => {
    for (const s of e.students) {
      const profile = lookup[s.name]
      if (profile && (profile.batches || []).includes(batchName)) return true
    }
    const hasAnyProfile = e.students.some(s => lookup[s.name])
    return !hasAnyProfile && e.batch === batchName
  })
}

// Exams where ≥1 attendee's CURRENT branch matches (roster-based, mirrors
// getExamsForBatch). Falls back to exam.branch only when no attendee has a profile.
// Used to scope the exam set to a branch's current cohort while still including the
// combined / pre-move exams those members actually sat (an exam-tag filter on
// exam.branch would drop a moved student's earlier-branch history).
export function getExamsForBranch(exams, studentProfiles, branchName) {
  const lookup = buildProfileLookup(studentProfiles)
  return exams.filter(e => {
    for (const s of e.students) {
      const profile = lookup[s.name]
      if (profile && profile.branch === branchName) return true
    }
    const hasAnyProfile = e.students.some(s => lookup[s.name])
    return !hasAnyProfile && e.branch === branchName
  })
}

// Exam-record names (canonical + every nameVariant) of students whose CURRENT
// profile batch includes batchName. Used to scope student-ranking analytics to a
// batch's *current* members — robust to batch/branch moves (a moved student's full
// exam history follows them; one who moved out drops off immediately). Skips
// variant-keyed map entries via `p.name === key`, same guard as getExamAbsentees.
export function getBatchMemberNames(studentProfiles, batchName) {
  const names = new Set()
  for (const [key, p] of Object.entries(studentProfiles || {})) {
    if (!p || p.name !== key) continue
    if (!(p.batches || []).includes(batchName)) continue
    names.add(p.name)
    for (const v of (p.nameVariants || [])) if (v) names.add(v)
  }
  return names
}

// Same, by current branch. Branch is kept in sync with batch (a batch belongs to
// exactly one branch), so this scopes to all current members of a branch.
export function getBranchMemberNames(studentProfiles, branchName) {
  const names = new Set()
  for (const [key, p] of Object.entries(studentProfiles || {})) {
    if (!p || p.name !== key) continue
    if (p.branch !== branchName) continue
    names.add(p.name)
    for (const v of (p.nameVariants || [])) if (v) names.add(v)
  }
  return names
}

// All exams a student appeared in, with their record
export function getStudentExams(name, exams) {
  return exams
    .map(exam => {
      const student = exam.students.find(s => s.name === name)
      return student ? { exam, student } : null
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.exam.date) - new Date(b.exam.date))
}
