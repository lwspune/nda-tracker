import { create } from 'zustand'
import { loadFromDisk, saveToStorage, clearStorage } from './persist'
import { supabase } from '../lib/supabase'
import { migrateFreq, exportDB, importDB } from '../lib/persistence'
import { DEFAULTS, hydrate } from './slices/defaults'
import { createExamsSlice } from './slices/examsSlice'
import { createStudentSlice } from './slices/studentSlice'
import { createInsightsSlice } from './slices/insightsSlice'
import { createNdaSlice } from './slices/ndaSlice'
import { createSyllabusSlice } from './slices/syllabusSlice'
import { createTimetableSlice } from './slices/timetableSlice'

const useStore = create((set, get) => ({
  // ── Data state ────────────────────────────────────────────
  ...hydrate(),

  // ── UI state ──────────────────────────────────────────────
  activePage: 'dashboard',
  activeStudent: null,
  uploadModalOpen: false,

  // ── Core helpers ──────────────────────────────────────────
  _save() {
    saveToStorage(get())
  },

  // ── Async initialisation ──────────────────────────────────
  // Dev:            loads from data/faculty-data.json via Vite plugin.
  // Prod (faculty): Supabase session detected → loads from faculty_state table.
  // Prod (teacher/student): no session → sets hydrated immediately.
  async initStore() {
    if (!import.meta.env.DEV) {
      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          set({ hydrated: false })
          const saved = await loadFromDisk()
          if (saved) {
            const { apiKey: _dropped, ...safeFields } = saved
            set({
              ...DEFAULTS,
              ...safeFields,
              savedInsights:           { ...DEFAULTS.savedInsights, ...saved.savedInsights },
              ndaFreqBySubject:        migrateFreq(saved),
              ndaMarksBySubject:       saved.ndaMarksBySubject || DEFAULTS.ndaMarksBySubject,
              syllabusPrograms:        saved.syllabusPrograms || [],
              syllabusBatches:         saved.syllabusBatches?.length
                                         ? saved.syllabusBatches
                                         : Object.keys(saved.batchProgramAssignments || {}),
              syllabusBatchBranches:   saved.syllabusBatchBranches || {},
              batchProgramAssignments: saved.batchProgramAssignments || {},
              batchSyllabusProgress:   saved.batchSyllabusProgress || {},
              batchChapterTimelines:   saved.batchChapterTimelines || {},
              timetableTeachers:       saved.timetableTeachers || [],
              timetableMappings:       saved.timetableMappings || [],
              timetables:              saved.timetables || [],
              examSchedules:           saved.examSchedules || [],
              hydrated: true,
            })
          } else {
            set({ hydrated: true })
          }
          return
        }
      }
      set({ hydrated: true })
      return
    }

    let saved = await loadFromDisk()

    // First-run migration: carry over localStorage data to disk and clear it
    if (!saved) {
      try {
        const lsRaw = localStorage.getItem('nda_tracker_v2')
        if (lsRaw) {
          saved = JSON.parse(lsRaw)
          saveToStorage({ ...DEFAULTS, ...saved })
          localStorage.removeItem('nda_tracker_v2')
          console.info('[NDA Tracker] Migrated localStorage → data/faculty-data.json')
        }
      } catch { /* ignore parse errors */ }
    }

    if (saved) {
      const { apiKey: _dropped, ...safeFields } = saved
      set({
        ...DEFAULTS,
        ...safeFields,
        savedInsights:          { ...DEFAULTS.savedInsights, ...saved.savedInsights },
        ndaFreqBySubject:       migrateFreq(saved),
        ndaMarksBySubject:      saved.ndaMarksBySubject || DEFAULTS.ndaMarksBySubject,
        syllabusPrograms:        saved.syllabusPrograms || [],
        syllabusBatches:         saved.syllabusBatches?.length
                                   ? saved.syllabusBatches
                                   : Object.keys(saved.batchProgramAssignments || {}),
        syllabusBatchBranches:   saved.syllabusBatchBranches || {},
        batchProgramAssignments: saved.batchProgramAssignments || {},
        batchSyllabusProgress:   saved.batchSyllabusProgress || {},
        batchChapterTimelines:   saved.batchChapterTimelines || {},
        timetableTeachers:       saved.timetableTeachers || [],
        timetableMappings:       saved.timetableMappings || [],
        timetables:              saved.timetables || [],
        examSchedules:           saved.examSchedules || [],
        hydrated: true,
      })
    } else {
      set({ hydrated: true })
    }
    // Seed program definitions if this is a fresh install
    get().seedSyllabusPrograms()
  },

  // ── Navigation ────────────────────────────────────────────
  setActivePage(page) {
    set({ activePage: page, activeStudent: null })
  },

  setActiveStudent(name) {
    set({ activeStudent: name, activePage: 'students' })
  },

  // ── Upload modal ──────────────────────────────────────────
  openUploadModal()  { set({ uploadModalOpen: true }) },
  closeUploadModal() { set({ uploadModalOpen: false }) },

  // ── Export / Import ───────────────────────────────────────
  exportDB() {
    const { exams, studentProfiles, savedInsights, ndaFreqBySubject, ndaMarksBySubject, costLog } = get()
    exportDB({ exams, studentProfiles, savedInsights, ndaFreqBySubject, ndaMarksBySubject, costLog })
  },

  importDB(json) {
    try {
      const { nextState, result } = importDB(json, get())
      set(nextState)
      get()._save()
      return result
    } catch (e) {
      throw new Error('Import failed: ' + e.message)
    }
  },

  // ── Load remote data (GitHub Pages read-only mode) ────────
  loadRemoteData(data) {
    if (!data) return
    set({
      exams:                   data.exams || [],
      studentProfiles:         data.studentProfiles || {},
      savedInsights:           data.savedInsights || DEFAULTS.savedInsights,
      ndaFreqBySubject:        migrateFreq(data),
      costLog:                 data.costLog || [],
      syllabusPrograms:        data.syllabusPrograms || [],
      syllabusBatches:         data.syllabusBatches?.length
                                 ? data.syllabusBatches
                                 : Object.keys(data.batchProgramAssignments || {}),
      syllabusBatchBranches:   data.syllabusBatchBranches || {},
      batchProgramAssignments: data.batchProgramAssignments || {},
      batchSyllabusProgress:   data.batchSyllabusProgress || {},
      batchChapterTimelines:   data.batchChapterTimelines || {},
      timetableTeachers:       data.timetableTeachers || [],
      timetableMappings:       data.timetableMappings || [],
      timetables:              data.timetables || [],
      examSchedules:           data.examSchedules || [],
    })
  },

  // ── Load single student data (student portal) ─────────────
  loadStudentData(data) {
    if (!data) return
    const profiles = {}
    if (data.profile) profiles[data.name] = data.profile
    set({
      exams:            data.exams || [],
      studentProfiles:  profiles,
      ndaFreqBySubject: migrateFreq(data),
      savedInsights:    DEFAULTS.savedInsights,
    })
  },

  // ── Clear all ─────────────────────────────────────────────
  clearAll() {
    clearStorage()
    set({ ...DEFAULTS, activePage: 'dashboard', activeStudent: null, uploadModalOpen: false })
  },

  // ── WhatsApp send history (faculty only, persisted) ──────
  setWhatsappSendHistory(examId, record) {
    set(s => ({ whatsappSendHistory: { ...s.whatsappSendHistory, [examId]: record } }))
    get()._save()
  },

  // ── Domain slices ─────────────────────────────────────────
  ...createExamsSlice(set, get),
  ...createStudentSlice(set, get),
  ...createInsightsSlice(set, get),
  ...createNdaSlice(set, get),
  ...createSyllabusSlice(set, get),
  ...createTimetableSlice(set, get),
}))

export default useStore
