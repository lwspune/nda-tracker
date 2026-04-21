import { mergeStudentRecords } from '../../lib/mergeStudents'

// Shared helper — POST updated students array back to students_db.json
async function persistStudentsDB(get, existing, students) {
  get().importStudentsDB(students)
  await fetch('/api/students-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...existing,
      students,
      last_updated: new Date().toISOString().split('T')[0],
    }, null, 2),
  })
}

export const createStudentSlice = (set, get) => ({
  // Builds studentProfiles in-store from the snake_case students_db array.
  // Called after every mutation that touches students_db.json.
  importStudentsDB(students) {
    const profiles = {}
    students.forEach(s => {
      const name = s.canonical_name || s.name
      if (!name) return
      const entry = {
        lwsId:         s.lws_id || '',
        name,
        mobile:        s.mobile || '',
        dob:           s.dob || '',
        gender:        s.gender || '',
        branch:        s.branch || '',
        batches:       s.batches || [],
        accountStatus: s.account_status || '',
        comingStatus:  s.coming_status || '',
        regDate:       s.registration_date || '',
        nameVariants:  s.name_variants || [],
      }
      profiles[name] = entry
      // Index name variants for fuzzy matching
      ;(s.name_variants || []).forEach(v => {
        if (v && v !== name) profiles[v] = entry
      })
    })
    set({ studentProfiles: profiles })
    get()._save()
    return Object.keys(profiles).length
  },

  // Called by ImportStudentsModal after mergeStudents() produces the merged array.
  // Updates studentProfiles in the store and persists students_db.json.
  async importStudentsFromExcel(mergeResult) {
    const { students, added, updated, unchanged } = mergeResult
    get().importStudentsDB(students)

    try {
      const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
      const dbPayload = {
        ...(existing || {}),
        students,
        total_students: students.length,
        last_updated: new Date().toISOString().split('T')[0],
      }
      await fetch('/api/students-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbPayload, null, 2),
      })
    } catch (_) { /* no-op in prod */ }

    return { added, updated, unchanged }
  },

  async renameBatch(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return
    set(s => ({
      exams: s.exams.map(e => ({ ...e, batch: e.batch === oldName ? newName : e.batch }))
    }))
    get()._save()
    try {
      const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
      if (!existing?.students) return
      const students = existing.students.map(s => ({
        ...s,
        batches: (s.batches || []).map(b => b === oldName ? newName : b),
      }))
      await persistStudentsDB(get, existing, students)
    } catch (_) { /* no-op in prod */ }
  },

  async renameBranch(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return
    set(s => ({
      exams: s.exams.map(e => ({ ...e, branch: e.branch === oldName ? newName : e.branch }))
    }))
    get()._save()
    try {
      const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
      if (!existing?.students) return
      const students = existing.students.map(s => ({
        ...s,
        branch: s.branch === oldName ? newName : s.branch,
      }))
      await persistStudentsDB(get, existing, students)
    } catch (_) { /* no-op in prod */ }
  },

  async bulkAssignBatch(lwsIds, batchName) {
    if (!lwsIds?.length || !batchName) return
    const lwsSet = new Set(lwsIds)
    try {
      const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
      if (!existing?.students) return
      const students = existing.students.map(s => {
        if (!lwsSet.has(s.lws_id)) return s
        const batches = s.batches || []
        return batches.includes(batchName) ? s : { ...s, batches: [...batches, batchName] }
      })
      await persistStudentsDB(get, existing, students)
    } catch (_) { /* no-op in prod */ }
  },

  async bulkAssignBranch(lwsIds, branchName) {
    if (!lwsIds?.length || !branchName) return
    const lwsSet = new Set(lwsIds)
    try {
      const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
      if (!existing?.students) return
      const students = existing.students.map(s =>
        lwsSet.has(s.lws_id) ? { ...s, branch: branchName } : s
      )
      await persistStudentsDB(get, existing, students)
    } catch (_) { /* no-op in prod */ }
  },

  async updateStudentBranchBatch(lwsId, name, { branch, batches }) {
    try {
      const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
      if (!existing?.students) return
      const students = existing.students.map(s => {
        const match = lwsId ? s.lws_id === lwsId : (s.canonical_name || s.name) === name
        return match ? { ...s, branch, batches } : s
      })
      await persistStudentsDB(get, existing, students)
    } catch (_) { /* no-op in prod */ }
  },

  async mergeStudentProfiles(primaryLwsId, secondaryLwsId) {
    if (!primaryLwsId || !secondaryLwsId || primaryLwsId === secondaryLwsId) return
    try {
      const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
      if (!existing?.students) return
      const students = mergeStudentRecords(existing.students, primaryLwsId, secondaryLwsId)
      await persistStudentsDB(get, existing, students)
    } catch (_) { /* no-op in prod */ }
  },
})
