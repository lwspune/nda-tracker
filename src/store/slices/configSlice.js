// Central config slice — single source of truth for the cross-cutting lists
// that other slices reference (branches today; future: shared mappings/etc).
//
// Why this exists: `timetables[].branch`, `examSchedules[].branch`, and
// `syllabusBatchBranches` values used to drift because no one owned the
// canonical branch list. `branches[]` lives here and `renameBranch` runs
// the cascade.
//
// `renameBatch` / `deleteBatch` / `batchInUseBy` don't add a new store
// key — they delegate to the existing syllabus + timetable slice actions
// so a rename in one place can't miss the other.

import { supabase } from '../../lib/supabase'
import { cascadeBatchRenameToSupabase } from './batchSupabase'

export const createConfigSlice = (set, get) => ({
  branches: [],

  // ── Monitoring numbers ──────────────────────────────────────
  // Replace the whole list. Each entry is normalised to its last 10 digits;
  // non-10-digit entries are dropped and duplicates collapsed. An empty list
  // disables monitoring. Seeded default lives in DEFAULTS (defaults.js).
  setMonitorMobiles(list) {
    const clean = (Array.isArray(list) ? list : [])
      .map(n => String(n ?? '').replace(/\D/g, '').slice(-10))
      .filter(n => n.length === 10)
    set({ monitorMobiles: [...new Set(clean)] })
    get()._save()
  },

  // ── Warden alert numbers ────────────────────────────────────
  // Same normalisation contract as setMonitorMobiles. Recipients of the hostel
  // unexplained-absence alert (APJ). Seeded empty in DEFAULTS.
  setHostelAlertMobiles(list) {
    const clean = (Array.isArray(list) ? list : [])
      .map(n => String(n ?? '').replace(/\D/g, '').slice(-10))
      .filter(n => n.length === 10)
    set({ hostelAlertMobiles: [...new Set(clean)] })
    get()._save()
  },

  // ── Branch CRUD ─────────────────────────────────────────────
  addBranch(name) {
    const trimmed = (name ?? '').trim()
    if (!trimmed) return
    let changed = false
    set(s => {
      if (s.branches.includes(trimmed)) return s
      changed = true
      return { branches: [...s.branches, trimmed] }
    })
    if (changed) get()._save()
  },

  renameBranch(oldName, newName) {
    const trimmed = (newName ?? '').trim()
    if (!trimmed || oldName === trimmed) return
    let changed = false
    set(s => {
      if (!s.branches.includes(oldName)) return s
      if (s.branches.includes(trimmed)) return s
      changed = true
      return {
        branches: s.branches.map(b => b === oldName ? trimmed : b),
        timetables: s.timetables.map(tt =>
          tt.branch === oldName ? { ...tt, branch: trimmed } : tt
        ),
        examSchedules: s.examSchedules.map(e =>
          e.branch === oldName ? { ...e, branch: trimmed } : e
        ),
        syllabusBatchBranches: Object.fromEntries(
          Object.entries(s.syllabusBatchBranches).map(([k, v]) =>
            [k, v === oldName ? trimmed : v]
          )
        ),
      }
    })
    if (changed) get()._save()
  },

  // Returns { timetables: count, examSchedules: count, syllabusBatches: [batchName, ...] }.
  // Used by the Settings UI to (a) decide whether deletion is allowed and
  // (b) show the caller exactly what's referencing the branch.
  branchInUseBy(name) {
    const s = get()
    return {
      timetables:     s.timetables.filter(t => t.branch === name).length,
      examSchedules:  s.examSchedules.filter(e => e.branch === name).length,
      syllabusBatches: Object.entries(s.syllabusBatchBranches)
        .filter(([, v]) => v === name)
        .map(([k]) => k),
    }
  },

  deleteBranch(name) {
    const usage = get().branchInUseBy(name)
    if (usage.timetables || usage.examSchedules || usage.syllabusBatches.length) {
      return { ok: false, usage }
    }
    let changed = false
    set(s => {
      if (!s.branches.includes(name)) return s
      changed = true
      return { branches: s.branches.filter(b => b !== name) }
    })
    if (changed) get()._save()
    return { ok: changed, usage }
  },

  // ── Unified batch CRUD ──────────────────────────────────────

  // Create a batch with a mandatory branch. Returns
  //   { ok: true, name }
  //   { ok: false, reason: 'name_required' | 'branch_required' | 'unknown_branch' | 'duplicate_name' }
  // The branch must already exist in branches[] — add the branch first if not.
  addBatch(name, branch) {
    const trimmed = (name ?? '').trim()
    const branchValue = (branch ?? '').trim()
    if (!trimmed)      return { ok: false, reason: 'name_required' }
    if (trimmed.includes(','))
                       return { ok: false, reason: 'comma_in_name' }
    if (!branchValue)  return { ok: false, reason: 'branch_required' }
    const s = get()
    if (!s.branches.includes(branchValue)) return { ok: false, reason: 'unknown_branch' }
    if (s.syllabusBatches.includes(trimmed)) return { ok: false, reason: 'duplicate_name' }
    if (s.timetables.some(t => t.batchName === trimmed)) return { ok: false, reason: 'duplicate_name' }
    get().addSyllabusBatch(trimmed)
    get().setSyllabusBatchBranch(trimmed, branchValue)
    return { ok: true, name: trimmed }
  },

  // Delegate to both syllabus + timetable rename actions so the two stores
  // can't diverge after a rename through this path. Either side may be
  // empty for the given oldName — each delegate is independently no-op-safe.
  //
  // Also fires a fire-and-forget Supabase cascade for student_batches and
  // exams.batch (the normalised tables the JSONB cascade can't reach). The
  // cascade is guarded behind the same validity checks as the delegates so
  // a rejected rename (e.g. newName already exists) doesn't silently merge
  // rows in Supabase while the local stores stay unchanged.
  renameBatch(oldName, newName) {
    const oldTrim = (oldName ?? '').trim()
    const newTrim = (newName ?? '').trim()
    if (!oldTrim || !newTrim || oldTrim === newTrim) return
    const s = get()
    const newAlreadyExists =
      s.syllabusBatches.includes(newTrim) ||
      s.timetables.some(t => t.batchName === newTrim)
    if (newAlreadyExists) return
    const exists =
      s.syllabusBatches.includes(oldTrim) ||
      s.timetables.some(t => t.batchName === oldTrim)
    if (!exists) return

    get().renameSyllabusBatch(oldTrim, newTrim)
    get().renameTimetableBatch(oldTrim, newTrim)

    cascadeBatchRenameToSupabase(supabase, oldTrim, newTrim)
      .catch(e => console.error('[configSlice] cascadeBatchRenameToSupabase failed:', e))
  },

  batchInUseBy(name) {
    const s = get()
    return {
      inSyllabus:         s.syllabusBatches.includes(name),
      timetableCount:     s.timetables.filter(t => t.batchName === name).length,
      examScheduleCount:  s.examSchedules.filter(e => e.batchName === name).length,
    }
  },

  // Deletes the batch from the syllabus side only when no timetable / exam
  // schedule references it. Deleting a batch with an active timetable would
  // destroy grid + slot data; the user has to delete those first.
  deleteBatch(name) {
    const usage = get().batchInUseBy(name)
    if (usage.timetableCount > 0 || usage.examScheduleCount > 0) {
      return { ok: false, usage }
    }
    if (usage.inSyllabus) get().deleteSyllabusBatch(name)
    return { ok: true, usage }
  },
})
