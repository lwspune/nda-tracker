// Shared helpers for batch/branch management tabs

export function uniqueSorted(arr) {
  return [...new Set(arr.filter(Boolean))].sort()
}

// Deduplicate studentProfiles (indexed by name + variants) by lwsId
export function uniqueStudents(studentProfiles) {
  const seen = new Set()
  return Object.values(studentProfiles)
    .filter(p => {
      if (!p.lwsId || seen.has(p.lwsId)) return false
      seen.add(p.lwsId)
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
