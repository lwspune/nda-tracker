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
