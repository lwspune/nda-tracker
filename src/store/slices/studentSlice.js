import { supabase } from '../../lib/supabase'
import { mergeStudentRecords } from '../../lib/mergeStudents'
import { loadExistingStudents } from '../../lib/students/loadExistingStudents'

// ── Supabase helpers (online faculty mode only) ────────────────

async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

async function refreshStudents(get) {
  const arr = await loadExistingStudents()
  if (!arr.length) return
  get().importStudentsDB(arr)
}

// ── Dev helper: full read-transform-write to students_db.json ──

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

// ──────────────────────────────────────────────────────────────

export const createStudentSlice = (set, get) => ({
  // Builds studentProfiles in-store from the snake_case students_db array.
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
        parentMobiles: s.parent_mobiles || [],
        accountStatus: s.account_status || '',
        comingStatus:  s.coming_status || '',
        regDate:       s.registration_date || '',
        nameVariants:  s.name_variants || [],
      }
      profiles[name] = entry
      ;(s.name_variants || []).forEach(v => {
        if (v && v !== name) profiles[v] = entry
      })
    })
    set({ studentProfiles: profiles, studentList: students })
    get()._save()
    return Object.keys(profiles).length
  },

  // Loads all students from Supabase tables into the store.
  // Called by initStore when a faculty session is active.
  async loadStudentsFromSupabase() {
    if (!supabase) return
    try {
      await refreshStudents(get)
    } catch (_) { /* no-op */ }
  },

  // Called by ImportStudentsModal after mergeStudents() produces the merged array.
  async importStudentsFromExcel(mergeResult) {
    const { students, added, updated, unchanged } = mergeResult
    get().importStudentsDB(students)

    const session = await getSession()
    if (session) {
      try {
        const rows = students.map(s => ({
          lws_id:            s.lws_id,
          canonical_name:    s.canonical_name || s.name || '',
          mobile:            s.mobile || '',
          dob:               s.dob || '',
          gender:            s.gender || '',
          email:             s.email || '',
          eis_reg_no:        s.eis_reg_no || '',
          registration_date: s.registration_date || '',
          branch:            s.branch || '',
          account_status:    s.account_status || '',
          coming_status:     s.coming_status || '',
          quit_date:         s.quit_date || '',
          name_variants:     s.name_variants || [],
          evalbee_roll_nos:  s.evalbee_roll_nos || [],
          match_signatures:  s.match_signatures || [],
          parent_mobiles:    s.parent_mobiles || [],
          fees:              s.fees || {},
          updated_at:        new Date().toISOString(),
        }))
        await supabase.from('students').upsert(rows, { onConflict: 'lws_id' })
        const lwsIds = students.map(s => s.lws_id).filter(Boolean)
        if (lwsIds.length) {
          await supabase.from('student_batches').delete().in('lws_id', lwsIds)
          const batchRows = students.flatMap(s =>
            (s.batches || []).map(b => ({ lws_id: s.lws_id, batch_name: b }))
          )
          if (batchRows.length) await supabase.from('student_batches').insert(batchRows)
        }
      } catch (_) { /* no-op */ }
    } else {
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
    }

    return { added, updated, unchanged }
  },

  async renameBatch(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return
    set(s => ({
      exams: s.exams.map(e => ({ ...e, batch: e.batch === oldName ? newName : e.batch }))
    }))
    get()._save()

    const session = await getSession()
    if (session) {
      try {
        const { data: affected } = await supabase
          .from('student_batches').select('lws_id').eq('batch_name', oldName)
        if (affected?.length) {
          await supabase.from('student_batches').delete().eq('batch_name', oldName)
          await supabase.from('student_batches')
            .insert(affected.map(r => ({ lws_id: r.lws_id, batch_name: newName })))
        }
        await refreshStudents(get)
      } catch (_) { /* no-op */ }
    } else {
      try {
        const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
        if (!existing?.students) return
        const students = existing.students.map(s => ({
          ...s, batches: (s.batches || []).map(b => b === oldName ? newName : b),
        }))
        await persistStudentsDB(get, existing, students)
      } catch (_) { /* no-op */ }
    }
  },

  async renameBranch(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return
    set(s => ({
      exams: s.exams.map(e => ({ ...e, branch: e.branch === oldName ? newName : e.branch }))
    }))
    get()._save()

    const session = await getSession()
    if (session) {
      try {
        await supabase.from('students').update({ branch: newName }).eq('branch', oldName)
        await refreshStudents(get)
      } catch (_) { /* no-op */ }
    } else {
      try {
        const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
        if (!existing?.students) return
        const students = existing.students.map(s => ({
          ...s, branch: s.branch === oldName ? newName : s.branch,
        }))
        await persistStudentsDB(get, existing, students)
      } catch (_) { /* no-op */ }
    }
  },

  async bulkAssignBatch(lwsIds, batchName) {
    if (!lwsIds?.length || !batchName) return

    const session = await getSession()
    if (session) {
      try {
        const rows = lwsIds.map(id => ({ lws_id: id, batch_name: batchName }))
        await supabase.from('student_batches').upsert(rows, {
          onConflict: 'lws_id,batch_name', ignoreDuplicates: true,
        })
        await refreshStudents(get)
      } catch (_) { /* no-op */ }
    } else {
      try {
        const lwsSet = new Set(lwsIds)
        const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
        if (!existing?.students) return
        const students = existing.students.map(s => {
          if (!lwsSet.has(s.lws_id)) return s
          const batches = s.batches || []
          return batches.includes(batchName) ? s : { ...s, batches: [...batches, batchName] }
        })
        await persistStudentsDB(get, existing, students)
      } catch (_) { /* no-op */ }
    }
  },

  async bulkAssignBranch(lwsIds, branchName) {
    if (!lwsIds?.length || !branchName) return

    const session = await getSession()
    if (session) {
      try {
        await supabase.from('students').update({ branch: branchName }).in('lws_id', lwsIds)
        await refreshStudents(get)
      } catch (_) { /* no-op */ }
    } else {
      try {
        const lwsSet = new Set(lwsIds)
        const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
        if (!existing?.students) return
        const students = existing.students.map(s =>
          lwsSet.has(s.lws_id) ? { ...s, branch: branchName } : s
        )
        await persistStudentsDB(get, existing, students)
      } catch (_) { /* no-op */ }
    }
  },

  async updateStudentParentMobiles(lwsId, name, parentMobiles) {
    const session = await getSession()
    if (session) {
      try {
        const q = supabase.from('students')
          .update({ parent_mobiles: parentMobiles, updated_at: new Date().toISOString() })
        await (lwsId ? q.eq('lws_id', lwsId) : q.eq('canonical_name', name))
        await refreshStudents(get)
      } catch (_) { /* no-op */ }
    } else {
      try {
        const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
        if (!existing?.students) return
        const students = existing.students.map(s => {
          const match = lwsId ? s.lws_id === lwsId : (s.canonical_name || s.name) === name
          return match ? { ...s, parent_mobiles: parentMobiles } : s
        })
        await persistStudentsDB(get, existing, students)
      } catch (_) { /* no-op */ }
    }
  },

  async updateStudentBranchBatch(lwsId, name, { branch, batches }) {
    const session = await getSession()
    if (session) {
      try {
        let matchId = lwsId
        if (!matchId) {
          const { data } = await supabase
            .from('students').select('lws_id').eq('canonical_name', name).single()
          matchId = data?.lws_id
        }
        if (!matchId) return
        await supabase.from('students')
          .update({ branch, updated_at: new Date().toISOString() })
          .eq('lws_id', matchId)
        await supabase.from('student_batches').delete().eq('lws_id', matchId)
        if (batches?.length) {
          await supabase.from('student_batches')
            .insert(batches.map(b => ({ lws_id: matchId, batch_name: b })))
        }
        await refreshStudents(get)
      } catch (_) { /* no-op */ }
    } else {
      try {
        const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
        if (!existing?.students) return
        const students = existing.students.map(s => {
          const match = lwsId ? s.lws_id === lwsId : (s.canonical_name || s.name) === name
          return match ? { ...s, branch, batches } : s
        })
        await persistStudentsDB(get, existing, students)
      } catch (_) { /* no-op */ }
    }
  },

  async addNameVariant(lwsId, variantName) {
    if (!lwsId || !variantName) return

    const session = await getSession()
    if (session) {
      try {
        const { data: student } = await supabase
          .from('students').select('name_variants').eq('lws_id', lwsId).single()
        if (!student) return
        const variants = student.name_variants || []
        if (variants.includes(variantName)) return
        await supabase.from('students')
          .update({ name_variants: [...variants, variantName], updated_at: new Date().toISOString() })
          .eq('lws_id', lwsId)
        await refreshStudents(get)
      } catch (_) { /* no-op */ }
    } else {
      try {
        const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
        if (!existing?.students) return
        const students = existing.students.map(s => {
          if (s.lws_id !== lwsId) return s
          const variants = s.name_variants || []
          if (variants.includes(variantName)) return s
          return { ...s, name_variants: [...variants, variantName] }
        })
        await persistStudentsDB(get, existing, students)
      } catch (_) { /* no-op */ }
    }
  },

  async bulkUpdateStudentContacts(edits) {
    if (!edits?.length) return

    const session = await getSession()
    if (session) {
      try {
        await Promise.all(edits.map(edit => {
          const q = supabase.from('students').update({
            branch:         edit.branch,
            mobile:         edit.mobile,
            parent_mobiles: edit.parentMobiles,
            updated_at:     new Date().toISOString(),
          })
          return edit.lwsId ? q.eq('lws_id', edit.lwsId) : q.eq('canonical_name', edit.name)
        }))
        await refreshStudents(get)
      } catch (_) { /* no-op */ }
    } else {
      try {
        const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
        if (!existing?.students) return
        const students = existing.students.map(s => {
          const edit = edits.find(e =>
            e.lwsId ? s.lws_id === e.lwsId : (s.canonical_name || s.name) === e.name
          )
          if (!edit) return s
          return { ...s, branch: edit.branch, mobile: edit.mobile, parent_mobiles: edit.parentMobiles }
        })
        await persistStudentsDB(get, existing, students)
      } catch (_) { /* no-op */ }
    }
  },

  async mergeStudentProfiles(primaryLwsId, secondaryLwsId) {
    if (!primaryLwsId || !secondaryLwsId || primaryLwsId === secondaryLwsId) return

    const session = await getSession()
    if (session) {
      try {
        const [{ data: primary }, { data: secondary }] = await Promise.all([
          supabase.from('students').select('*, student_batches(batch_name)').eq('lws_id', primaryLwsId).single(),
          supabase.from('students').select('*, student_batches(batch_name)').eq('lws_id', secondaryLwsId).single(),
        ])
        if (!primary || !secondary) return

        const mergedBatches = [...new Set([
          ...(primary.student_batches||[]).map(b=>b.batch_name),
          ...(secondary.student_batches||[]).map(b=>b.batch_name),
        ])]
        // Primary wins on scalar fields; merge arrays
        await supabase.from('students').update({
          name_variants:     [...new Set([...primary.name_variants||[], ...secondary.name_variants||[], secondary.canonical_name])]
                               .filter(v => v !== primary.canonical_name),
          evalbee_roll_nos:  [...new Set([...primary.evalbee_roll_nos||[], ...secondary.evalbee_roll_nos||[]])],
          match_signatures:  [...new Set([...primary.match_signatures||[], ...secondary.match_signatures||[]])],
          parent_mobiles:    [...new Set([...primary.parent_mobiles||[], ...secondary.parent_mobiles||[]])],
          updated_at:        new Date().toISOString(),
        }).eq('lws_id', primaryLwsId)

        await supabase.from('student_batches').delete().eq('lws_id', primaryLwsId)
        if (mergedBatches.length) {
          await supabase.from('student_batches')
            .insert(mergedBatches.map(b => ({ lws_id: primaryLwsId, batch_name: b })))
        }
        await supabase.from('students').delete().eq('lws_id', secondaryLwsId)
        await refreshStudents(get)
      } catch (_) { /* no-op */ }
    } else {
      try {
        const existing = await fetch('/api/students-db').then(r => r.json()).catch(() => null)
        if (!existing?.students) return
        const students = mergeStudentRecords(existing.students, primaryLwsId, secondaryLwsId)
        await persistStudentsDB(get, existing, students)
      } catch (_) { /* no-op */ }
    }
  },
})
