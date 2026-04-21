import { create } from 'zustand'
import { loadFromDisk, saveToStorage, clearStorage } from './persist'
import { migrateFreq, exportDB, importDB } from '../lib/persistence'
import { DEFAULTS, hydrate } from './slices/defaults'
import { createExamsSlice } from './slices/examsSlice'
import { createStudentSlice } from './slices/studentSlice'
import { createInsightsSlice } from './slices/insightsSlice'
import { createNdaSlice } from './slices/ndaSlice'

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

  // ── Async initialisation (dev mode only) ──────────────────
  // Loads data from data/faculty-data.json via the Vite dev plugin.
  // On the very first run, migrates any existing localStorage data to disk.
  async initStore() {
    if (!import.meta.env.DEV) {
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
        savedInsights:     { ...DEFAULTS.savedInsights, ...saved.savedInsights },
        ndaFreqBySubject:  migrateFreq(saved),
        ndaMarksBySubject: saved.ndaMarksBySubject || DEFAULTS.ndaMarksBySubject,
        hydrated: true,
      })
    } else {
      set({ hydrated: true })
    }
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
      exams:            data.exams || [],
      studentProfiles:  data.studentProfiles || {},
      savedInsights:    data.savedInsights || DEFAULTS.savedInsights,
      ndaFreqBySubject: migrateFreq(data),
      costLog:          data.costLog || [],
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

  // ── Domain slices ─────────────────────────────────────────
  ...createExamsSlice(set, get),
  ...createStudentSlice(set, get),
  ...createInsightsSlice(set, get),
  ...createNdaSlice(set, get),
}))

export default useStore
