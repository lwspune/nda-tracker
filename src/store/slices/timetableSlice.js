let _seq = Date.now()
const uid = (prefix) => `${prefix}_${(++_seq).toString(36)}`

const STATUS_CYCLE = { Planned: 'Completed', Completed: 'Cancelled', Cancelled: 'Planned' }

export const createTimetableSlice = (set, get) => ({
  timetableTeachers: [],
  timetableMappings: [],
  timetables: [],
  examSchedules: [],

  // ── Teacher CRUD ──────────────────────────────────────────────
  addTimetableTeacher(name, email = '') {
    const trimmed = name.trim()
    if (!trimmed) return null
    const id = uid('tchr')
    set(s => ({ timetableTeachers: [...s.timetableTeachers, { id, name: trimmed, email: email.trim() }] }))
    get()._save()
    return id
  },

  // patch: { name?, email? }
  updateTimetableTeacher(id, patch) {
    const update = {}
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim()
      if (!trimmed) return
      update.name = trimmed
    }
    if (patch.email !== undefined) update.email = patch.email.trim()
    if (!Object.keys(update).length) return
    set(s => ({
      timetableTeachers: s.timetableTeachers.map(t =>
        t.id === id ? { ...t, ...update } : t
      )
    }))
    get()._save()
  },

  deleteTimetableTeacher(id) {
    set(s => ({
      timetableTeachers: s.timetableTeachers.filter(t => t.id !== id),
      timetableMappings: s.timetableMappings.map(m =>
        m.teacherId === id ? { ...m, teacherId: null } : m
      ),
      examSchedules: s.examSchedules.map(e =>
        e.teacherId === id ? { ...e, teacherId: null } : e
      ),
    }))
    get()._save()
  },

  // ── Mapping CRUD ──────────────────────────────────────────────
  addTimetableMapping(label, subject, teacherId) {
    const trimmed = label.trim()
    if (!trimmed) return null
    const id = uid('map')
    set(s => ({
      timetableMappings: [...s.timetableMappings, { id, label: trimmed, subject: subject ?? null, teacherId: teacherId ?? null }]
    }))
    get()._save()
    return id
  },

  updateTimetableMapping(id, patch) {
    set(s => ({
      timetableMappings: s.timetableMappings.map(m =>
        m.id === id ? { ...m, ...patch } : m
      )
    }))
    get()._save()
  },

  deleteTimetableMapping(id) {
    set(s => ({
      timetableMappings: s.timetableMappings.filter(m => m.id !== id),
      // Remove cells in all timetable grids that reference this mapping
      timetables: s.timetables.map(tt => {
        const grid = { ...tt.grid }
        for (const slotId of Object.keys(grid)) {
          const row = { ...grid[slotId] }
          for (const day of Object.keys(row)) {
            if (row[day]?.mappingId === id) {
              delete row[day]
            }
          }
          grid[slotId] = row
        }
        return { ...tt, grid }
      }),
    }))
    get()._save()
  },

  // ── Timetable CRUD ────────────────────────────────────────────
  addTimetable(branch, batchName) {
    const id = uid('tt')
    set(s => ({
      timetables: [...s.timetables, { id, branch, batchName, timeSlots: [], grid: {} }]
    }))
    get()._save()
    return id
  },

  updateTimetable(id, patch) {
    set(s => ({
      timetables: s.timetables.map(tt =>
        tt.id === id ? { ...tt, ...patch } : tt
      )
    }))
    get()._save()
  },

  deleteTimetable(id) {
    set(s => ({ timetables: s.timetables.filter(tt => tt.id !== id) }))
    get()._save()
  },

  // ── Slot CRUD ─────────────────────────────────────────────────
  addTimetableSlot(timetableId, startTime, endTime) {
    const slotId = uid('slot')
    set(s => ({
      timetables: s.timetables.map(tt =>
        tt.id !== timetableId ? tt : {
          ...tt,
          timeSlots: [...tt.timeSlots, { id: slotId, startTime, endTime }]
        }
      )
    }))
    get()._save()
    return slotId
  },

  updateTimetableSlot(timetableId, slotId, patch) {
    set(s => ({
      timetables: s.timetables.map(tt =>
        tt.id !== timetableId ? tt : {
          ...tt,
          timeSlots: tt.timeSlots.map(sl =>
            sl.id === slotId ? { ...sl, ...patch } : sl
          )
        }
      )
    }))
    get()._save()
  },

  deleteTimetableSlot(timetableId, slotId) {
    set(s => ({
      timetables: s.timetables.map(tt => {
        if (tt.id !== timetableId) return tt
        const { [slotId]: _dropped, ...grid } = tt.grid
        return {
          ...tt,
          timeSlots: tt.timeSlots.filter(sl => sl.id !== slotId),
          grid,
        }
      })
    }))
    get()._save()
  },

  // ── Cell mutations ────────────────────────────────────────────
  // type = 'class' → { type, mappingId }
  // type = 'break' → { type, label }
  setTimetableCell(timetableId, slotId, day, type, mappingId, label) {
    const cell = type === 'class'
      ? { type: 'class', mappingId }
      : { type: 'break', label: label ?? '' }
    set(s => ({
      timetables: s.timetables.map(tt => {
        if (tt.id !== timetableId) return tt
        return {
          ...tt,
          grid: {
            ...tt.grid,
            [slotId]: {
              ...tt.grid[slotId],
              [day]: cell,
            }
          }
        }
      })
    }))
    get()._save()
  },

  clearTimetableCell(timetableId, slotId, day) {
    set(s => ({
      timetables: s.timetables.map(tt => {
        if (tt.id !== timetableId) return tt
        const row = { ...tt.grid[slotId] }
        delete row[day]
        return { ...tt, grid: { ...tt.grid, [slotId]: row } }
      })
    }))
    get()._save()
  },

  // Full-row span cell (e.g. "Lunch Break" spanning all days)
  // Stored under the special key '__span' in the slot's grid row.
  setTimetableSpanCell(timetableId, slotId, label) {
    set(s => ({
      timetables: s.timetables.map(tt => {
        if (tt.id !== timetableId) return tt
        return {
          ...tt,
          grid: {
            ...tt.grid,
            [slotId]: {
              ...tt.grid[slotId],
              __span: { type: 'span', label },
            }
          }
        }
      })
    }))
    get()._save()
  },

  clearTimetableSpanCell(timetableId, slotId) {
    set(s => ({
      timetables: s.timetables.map(tt => {
        if (tt.id !== timetableId) return tt
        const row = { ...tt.grid[slotId] }
        delete row['__span']
        return { ...tt, grid: { ...tt.grid, [slotId]: row } }
      })
    }))
    get()._save()
  },

  // ── Exam schedule CRUD ────────────────────────────────────────────────────
  addExamSchedule({ date, startTime, endTime, subject, chapter, teacherId, branch, batchName, status }) {
    const id = uid('exam')
    set(s => ({
      examSchedules: [...s.examSchedules, {
        id, date, startTime, endTime, subject, chapter,
        teacherId: teacherId ?? null,
        branch, batchName,
        status: status ?? 'Planned',
      }]
    }))
    get()._save()
    return id
  },

  updateExamSchedule(id, patch) {
    set(s => ({
      examSchedules: s.examSchedules.map(e => e.id === id ? { ...e, ...patch } : e)
    }))
    get()._save()
  },

  deleteExamSchedule(id) {
    set(s => ({ examSchedules: s.examSchedules.filter(e => e.id !== id) }))
    get()._save()
  },

  cycleExamStatus(id) {
    set(s => ({
      examSchedules: s.examSchedules.map(e =>
        e.id === id ? { ...e, status: STATUS_CYCLE[e.status] ?? 'Planned' } : e
      )
    }))
    get()._save()
  },
})
