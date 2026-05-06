import { SYLLABUS_SEED } from '../../lib/syllabusSeed'

// ── ID helpers ────────────────────────────────────────────────
let _seq = Date.now()
const uid = (prefix) => `${prefix}_${(++_seq).toString(36)}`

// ── Status cycle: null → 'In Progress' → 'Done' → null ───────
export const STATUS_CYCLE = [null, 'In Progress', 'Done']
export function nextStatus(current) {
  const idx = STATUS_CYCLE.indexOf(current)
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
}

export const createSyllabusSlice = (set, get) => ({
  // ── Program definitions ───────────────────────────────────
  syllabusPrograms: [],

  // ── Syllabus-owned batch list (independent of exam batches) ──
  syllabusBatches: [],

  // ── Batch → program assignments ───────────────────────────
  // { batchName: [programId, ...] }
  batchProgramAssignments: {},

  // ── Progress ──────────────────────────────────────────────
  // { batchName: { programId: { subjectId: { chapterId: { col: status } } } } }
  batchSyllabusProgress: {},

  // ── Chapter timelines (batch-level) ───────────────────────
  // { batchName: { programId: { subjectId: { chapterId: "YYYY-MM" } } } }
  batchChapterTimelines: {},

  // ── Seed (called from initStore when syllabusPrograms is empty) ──
  seedSyllabusPrograms() {
    if (get().syllabusPrograms.length === 0) {
      set({ syllabusPrograms: SYLLABUS_SEED })
      get()._save()
    }
  },

  // ── Program CRUD ──────────────────────────────────────────
  addProgram(name, trackingColumns) {
    const prog = { id: uid('prog'), name, trackingColumns, subjects: [] }
    set(s => ({ syllabusPrograms: [...s.syllabusPrograms, prog] }))
    get()._save()
    return prog.id
  },

  updateProgram(programId, patch) {
    set(s => ({
      syllabusPrograms: s.syllabusPrograms.map(p =>
        p.id === programId ? { ...p, ...patch } : p
      )
    }))
    get()._save()
  },

  deleteProgram(programId) {
    set(s => {
      const assignments = { ...s.batchProgramAssignments }
      for (const batch of Object.keys(assignments)) {
        assignments[batch] = assignments[batch].filter(id => id !== programId)
      }
      const progress = { ...s.batchSyllabusProgress }
      for (const batch of Object.keys(progress)) {
        const { [programId]: _dropped, ...rest } = progress[batch]
        progress[batch] = rest
      }
      const timelines = { ...s.batchChapterTimelines }
      for (const batch of Object.keys(timelines)) {
        const { [programId]: _dropped, ...rest } = timelines[batch]
        timelines[batch] = rest
      }
      return {
        syllabusPrograms: s.syllabusPrograms.filter(p => p.id !== programId),
        batchProgramAssignments: assignments,
        batchSyllabusProgress: progress,
        batchChapterTimelines: timelines,
      }
    })
    get()._save()
  },

  // ── Subject CRUD ──────────────────────────────────────────
  addSubject(programId, name) {
    const subj = { id: uid('subj'), name, chapters: [] }
    set(s => ({
      syllabusPrograms: s.syllabusPrograms.map(p =>
        p.id === programId
          ? { ...p, subjects: [...p.subjects, subj] }
          : p
      )
    }))
    get()._save()
    return subj.id
  },

  updateSubject(programId, subjectId, patch) {
    set(s => ({
      syllabusPrograms: s.syllabusPrograms.map(p =>
        p.id !== programId ? p : {
          ...p,
          subjects: p.subjects.map(s =>
            s.id === subjectId ? { ...s, ...patch } : s
          )
        }
      )
    }))
    get()._save()
  },

  deleteSubject(programId, subjectId) {
    set(s => {
      const progress = { ...s.batchSyllabusProgress }
      for (const batch of Object.keys(progress)) {
        if (progress[batch][programId]) {
          const { [subjectId]: _dropped, ...rest } = progress[batch][programId]
          progress[batch] = { ...progress[batch], [programId]: rest }
        }
      }
      const timelines = { ...s.batchChapterTimelines }
      for (const batch of Object.keys(timelines)) {
        if (timelines[batch]?.[programId]) {
          const { [subjectId]: _dropped, ...rest } = timelines[batch][programId]
          timelines[batch] = { ...timelines[batch], [programId]: rest }
        }
      }
      return {
        syllabusPrograms: s.syllabusPrograms.map(p =>
          p.id !== programId ? p : {
            ...p,
            subjects: p.subjects.filter(s => s.id !== subjectId)
          }
        ),
        batchSyllabusProgress: progress,
        batchChapterTimelines: timelines,
      }
    })
    get()._save()
  },

  // ── Chapter CRUD ──────────────────────────────────────────
  addChapter(programId, subjectId, name, group = null) {
    const ch = { id: uid('ch'), name, group }
    set(s => ({
      syllabusPrograms: s.syllabusPrograms.map(p =>
        p.id !== programId ? p : {
          ...p,
          subjects: p.subjects.map(subj =>
            subj.id !== subjectId ? subj : {
              ...subj,
              chapters: [...subj.chapters, ch]
            }
          )
        }
      )
    }))
    get()._save()
    return ch.id
  },

  updateChapter(programId, subjectId, chapterId, patch) {
    set(s => ({
      syllabusPrograms: s.syllabusPrograms.map(p =>
        p.id !== programId ? p : {
          ...p,
          subjects: p.subjects.map(subj =>
            subj.id !== subjectId ? subj : {
              ...subj,
              chapters: subj.chapters.map(ch =>
                ch.id === chapterId ? { ...ch, ...patch } : ch
              )
            }
          )
        }
      )
    }))
    get()._save()
  },

  deleteChapter(programId, subjectId, chapterId) {
    set(s => {
      const progress = { ...s.batchSyllabusProgress }
      for (const batch of Object.keys(progress)) {
        if (progress[batch]?.[programId]?.[subjectId]) {
          const { [chapterId]: _dropped, ...rest } = progress[batch][programId][subjectId]
          progress[batch] = {
            ...progress[batch],
            [programId]: {
              ...progress[batch][programId],
              [subjectId]: rest,
            }
          }
        }
      }
      const timelines = { ...s.batchChapterTimelines }
      for (const batch of Object.keys(timelines)) {
        if (timelines[batch]?.[programId]?.[subjectId]) {
          const { [chapterId]: _dropped, ...rest } = timelines[batch][programId][subjectId]
          timelines[batch] = {
            ...timelines[batch],
            [programId]: {
              ...timelines[batch][programId],
              [subjectId]: rest,
            }
          }
        }
      }
      return {
        syllabusPrograms: s.syllabusPrograms.map(p =>
          p.id !== programId ? p : {
            ...p,
            subjects: p.subjects.map(subj =>
              subj.id !== subjectId ? subj : {
                ...subj,
                chapters: subj.chapters.filter(ch => ch.id !== chapterId)
              }
            )
          }
        ),
        batchSyllabusProgress: progress,
        batchChapterTimelines: timelines,
      }
    })
    get()._save()
  },

  reorderChapters(programId, subjectId, orderedIds) {
    set(s => ({
      syllabusPrograms: s.syllabusPrograms.map(p =>
        p.id !== programId ? p : {
          ...p,
          subjects: p.subjects.map(subj => {
            if (subj.id !== subjectId) return subj
            const map = Object.fromEntries(subj.chapters.map(ch => [ch.id, ch]))
            return { ...subj, chapters: orderedIds.map(id => map[id]).filter(Boolean) }
          })
        }
      )
    }))
    get()._save()
  },

  // ── Tracking column CRUD (on program) ─────────────────────
  addTrackingColumn(programId, colName) {
    set(s => ({
      syllabusPrograms: s.syllabusPrograms.map(p =>
        p.id === programId
          ? { ...p, trackingColumns: [...p.trackingColumns, colName] }
          : p
      )
    }))
    get()._save()
  },

  renameTrackingColumn(programId, oldName, newName) {
    set(s => {
      // Rename column in program definition
      const programs = s.syllabusPrograms.map(p =>
        p.id !== programId ? p : {
          ...p,
          trackingColumns: p.trackingColumns.map(c => c === oldName ? newName : c)
        }
      )
      // Rename column key in all progress records for this program
      const progress = { ...s.batchSyllabusProgress }
      for (const batch of Object.keys(progress)) {
        if (!progress[batch]?.[programId]) continue
        const progData = { ...progress[batch][programId] }
        for (const subjId of Object.keys(progData)) {
          const subjData = { ...progData[subjId] }
          for (const chId of Object.keys(subjData)) {
            if (oldName in subjData[chId]) {
              const { [oldName]: val, ...rest } = subjData[chId]
              subjData[chId] = { ...rest, [newName]: val }
            }
          }
          progData[subjId] = subjData
        }
        progress[batch] = { ...progress[batch], [programId]: progData }
      }
      return { syllabusPrograms: programs, batchSyllabusProgress: progress }
    })
    get()._save()
  },

  deleteTrackingColumn(programId, colName) {
    set(s => {
      const programs = s.syllabusPrograms.map(p =>
        p.id !== programId ? p : {
          ...p,
          trackingColumns: p.trackingColumns.filter(c => c !== colName)
        }
      )
      const progress = { ...s.batchSyllabusProgress }
      for (const batch of Object.keys(progress)) {
        if (!progress[batch]?.[programId]) continue
        const progData = { ...progress[batch][programId] }
        for (const subjId of Object.keys(progData)) {
          const subjData = { ...progData[subjId] }
          for (const chId of Object.keys(subjData)) {
            const { [colName]: _dropped, ...rest } = subjData[chId]
            subjData[chId] = rest
          }
          progData[subjId] = subjData
        }
        progress[batch] = { ...progress[batch], [programId]: progData }
      }
      return { syllabusPrograms: programs, batchSyllabusProgress: progress }
    })
    get()._save()
  },

  // ── Batch → branch mapping ────────────────────────────────
  // { batchName: branchName }
  syllabusBatchBranches: {},

  setSyllabusBatchBranch(batchName, branch) {
    set(s => {
      if (branch == null) {
        const { [batchName]: _dropped, ...rest } = s.syllabusBatchBranches
        return { syllabusBatchBranches: rest }
      }
      return { syllabusBatchBranches: { ...s.syllabusBatchBranches, [batchName]: branch } }
    })
    get()._save()
  },

  // ── Syllabus batch CRUD ───────────────────────────────────
  addSyllabusBatch(name) {
    const trimmed = name.trim()
    if (!trimmed) return
    set(s => {
      if (s.syllabusBatches.includes(trimmed)) return s
      return { syllabusBatches: [...s.syllabusBatches, trimmed] }
    })
    get()._save()
  },

  renameSyllabusBatch(oldName, newName) {
    const trimmed = newName.trim()
    if (!trimmed || oldName === trimmed) return
    set(s => {
      if (!s.syllabusBatches.includes(oldName)) return s
      if (s.syllabusBatches.includes(trimmed)) return s
      const batches = s.syllabusBatches.map(b => b === oldName ? trimmed : b)
      const assignments = {}
      for (const [k, v] of Object.entries(s.batchProgramAssignments)) {
        assignments[k === oldName ? trimmed : k] = v
      }
      const progress = {}
      for (const [k, v] of Object.entries(s.batchSyllabusProgress)) {
        progress[k === oldName ? trimmed : k] = v
      }
      const batchBranches = {}
      for (const [k, v] of Object.entries(s.syllabusBatchBranches)) {
        batchBranches[k === oldName ? trimmed : k] = v
      }
      const timelines = {}
      for (const [k, v] of Object.entries(s.batchChapterTimelines)) {
        timelines[k === oldName ? trimmed : k] = v
      }
      return { syllabusBatches: batches, batchProgramAssignments: assignments, batchSyllabusProgress: progress, syllabusBatchBranches: batchBranches, batchChapterTimelines: timelines }
    })
    get()._save()
  },

  deleteSyllabusBatch(name) {
    set(s => {
      const { [name]: _a, ...assignments }    = s.batchProgramAssignments
      const { [name]: _p, ...progress }       = s.batchSyllabusProgress
      const { [name]: _b, ...batchBranches }  = s.syllabusBatchBranches
      const { [name]: _t, ...timelines }      = s.batchChapterTimelines
      return {
        syllabusBatches: s.syllabusBatches.filter(b => b !== name),
        batchProgramAssignments: assignments,
        batchSyllabusProgress: progress,
        syllabusBatchBranches: batchBranches,
        batchChapterTimelines: timelines,
      }
    })
    get()._save()
  },

  // ── Batch assignments ─────────────────────────────────────
  setAssignedPrograms(batchName, programIds) {
    set(s => ({
      batchProgramAssignments: {
        ...s.batchProgramAssignments,
        [batchName]: programIds,
      }
    }))
    get()._save()
  },

  // ── Progress ──────────────────────────────────────────────
  cycleChapterStatus(batchName, programId, subjectId, chapterId, column) {
    set(s => {
      const current = s.batchSyllabusProgress?.[batchName]?.[programId]?.[subjectId]?.[chapterId]?.[column] ?? null
      const next = nextStatus(current)
      return {
        batchSyllabusProgress: {
          ...s.batchSyllabusProgress,
          [batchName]: {
            ...s.batchSyllabusProgress?.[batchName],
            [programId]: {
              ...s.batchSyllabusProgress?.[batchName]?.[programId],
              [subjectId]: {
                ...s.batchSyllabusProgress?.[batchName]?.[programId]?.[subjectId],
                [chapterId]: {
                  ...s.batchSyllabusProgress?.[batchName]?.[programId]?.[subjectId]?.[chapterId],
                  [column]: next,
                }
              }
            }
          }
        }
      }
    })
    get()._save()
  },

  getChapterStatus(batchName, programId, subjectId, chapterId, column) {
    return get().batchSyllabusProgress?.[batchName]?.[programId]?.[subjectId]?.[chapterId]?.[column] ?? null
  },

  clearSubjectProgress(batchName, programId, subjectId) {
    set(s => {
      const batch = s.batchSyllabusProgress?.[batchName]
      if (!batch?.[programId]?.[subjectId]) return s
      const { [subjectId]: _dropped, ...restSubjects } = batch[programId]
      return {
        batchSyllabusProgress: {
          ...s.batchSyllabusProgress,
          [batchName]: {
            ...batch,
            [programId]: restSubjects,
          }
        }
      }
    })
    get()._save()
  },

  // ── Chapter timelines ─────────────────────────────────────
  setChapterTimeline(batchName, programId, subjectId, chapterId, value) {
    set(s => {
      const cur = s.batchChapterTimelines
      if (!value) {
        // Clear the entry
        const subj = cur?.[batchName]?.[programId]?.[subjectId]
        if (!subj || !(chapterId in subj)) return s
        const { [chapterId]: _dropped, ...restChapters } = subj
        return {
          batchChapterTimelines: {
            ...cur,
            [batchName]: {
              ...cur[batchName],
              [programId]: {
                ...cur?.[batchName]?.[programId],
                [subjectId]: restChapters,
              }
            }
          }
        }
      }
      return {
        batchChapterTimelines: {
          ...cur,
          [batchName]: {
            ...cur?.[batchName],
            [programId]: {
              ...cur?.[batchName]?.[programId],
              [subjectId]: {
                ...cur?.[batchName]?.[programId]?.[subjectId],
                [chapterId]: value,
              }
            }
          }
        }
      }
    })
    get()._save()
  },

  getChapterTimeline(batchName, programId, subjectId, chapterId) {
    return get().batchChapterTimelines?.[batchName]?.[programId]?.[subjectId]?.[chapterId] ?? null
  },

  // Returns { done, inProgress, total } for a subject in a batch
  getSubjectProgress(batchName, programId, subjectId) {
    const prog = get()
    const subj = prog.syllabusPrograms
      .find(p => p.id === programId)
      ?.subjects.find(s => s.id === subjectId)
    if (!subj) return { done: 0, inProgress: 0, total: 0 }
    const program = prog.syllabusPrograms.find(p => p.id === programId)
    const cols = program.trackingColumns
    let done = 0, inProgress = 0
    for (const ch of subj.chapters) {
      const statuses = cols.map(col => prog.getChapterStatus(batchName, programId, subjectId, ch.id, col))
      if (statuses.every(s => s === 'Done')) done++
      else if (statuses.some(s => s !== null)) inProgress++
    }
    return { done, inProgress, total: subj.chapters.length }
  },
})
