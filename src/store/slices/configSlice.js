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

    // Carry the archived flag across. Dropping it here would silently un-archive a
    // retired batch, putting it back into every authoring picker with no visible cause.
    set(s => (s.archivedBatches ?? []).includes(oldTrim)
      ? { archivedBatches: s.archivedBatches.map(b => b === oldTrim ? newTrim : b) }
      : s
    )

    cascadeBatchRenameToSupabase(supabase, oldTrim, newTrim)
      .catch(e => console.error('[configSlice] cascadeBatchRenameToSupabase failed:', e))
  },

  batchInUseBy(name) {
    const s = get()
    // Students currently holding the batch. Read from the in-memory profiles, not
    // Supabase: the same source `StudentsTable.isAligned` uses, so the two can't
    // disagree, and it works on the dev disk path where there is no Supabase at all.
    // `p.name === key` skips variant-keyed entries — studentProfiles is indexed by
    // canonical name AND every name variant, so a variant would double-count its
    // student (same guard as `getBatchMemberNames`).
    let memberCount = 0
    for (const [key, p] of Object.entries(s.studentProfiles ?? {})) {
      if (!p || p.name !== key) continue
      if ((p.batches ?? []).includes(name)) memberCount++
    }
    return {
      inSyllabus:         s.syllabusBatches.includes(name),
      timetableCount:     s.timetables.filter(t => t.batchName === name).length,
      examScheduleCount:  s.examSchedules.filter(e => e.batchName === name).length,
      memberCount,
    }
  },

  // ── Archive / unarchive ─────────────────────────────────────
  // Retires a batch from active teaching WITHOUT deleting anything. Reversible,
  // and deliberately shaped like setAccountStatus (one action, both directions)
  // rather than an irreversible verb.
  //
  // `archivedBatches` is PRESENTATIONAL ONLY — it hides the batch from pickers that
  // assign new work. It must never be read by anything that computes a number,
  // validates a value, or determines a stored string's content. In particular the
  // exam/quiz batch pickers must keep building their comma-joined tag from the FULL
  // syllabusBatches order, or re-editing an exam tagged with an archived batch would
  // silently drop that tag. See BATCH_RETIREMENT.md §2.
  //
  // Returns { ok: true } | { ok: false, reason: 'unknown_batch' }.
  setBatchArchived(name, archived) {
    const trimmed = (name ?? '').trim()
    if (!trimmed) return { ok: false, reason: 'unknown_batch' }
    const s = get()
    const known =
      s.syllabusBatches.includes(trimmed) ||
      s.timetables.some(t => t.batchName === trimmed)
    if (!known) return { ok: false, reason: 'unknown_batch' }

    const current = s.archivedBatches ?? []
    const isArchived = current.includes(trimmed)
    if (archived === isArchived) return { ok: true }   // already in the requested state

    set(st => ({
      archivedBatches: archived
        ? [...(st.archivedBatches ?? []), trimmed]
        : (st.archivedBatches ?? []).filter(b => b !== trimmed),
    }))
    get()._save()
    return { ok: true }
  },

  // Deletes the batch from the syllabus side only when nothing still references it.
  // Deleting a batch with an active timetable would destroy grid + slot data.
  //
  // The `memberCount` guard exists because delete is NOT how a finished batch is
  // retired — archiving is. This action never touches Supabase, so deleting a batch
  // students still hold leaves every `student_batches` row orphaned: the name leaves
  // `syllabusBatches`, Settings (which lists syllabus ∪ timetables) can no longer see
  // it, and it goes on appearing in every analytics dropdown forever with no way to
  // reach it. Delete stays correct only for a batch created in error.
  deleteBatch(name) {
    const usage = get().batchInUseBy(name)
    if (usage.timetableCount > 0 || usage.examScheduleCount > 0 || usage.memberCount > 0) {
      return { ok: false, usage }
    }
    if (usage.inSyllabus) get().deleteSyllabusBatch(name)
    // Prune the archived entry too. A stale one would shadow a future batch of the
    // same name — created unarchived, but read as archived by every picker.
    let pruned = false
    set(s => {
      if (!(s.archivedBatches ?? []).includes(name)) return s
      pruned = true
      return { archivedBatches: s.archivedBatches.filter(b => b !== name) }
    })
    if (pruned) get()._save()
    return { ok: true, usage }
  },
})
