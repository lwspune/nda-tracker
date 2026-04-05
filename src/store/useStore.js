import { create } from 'zustand'
import { loadFromStorage, saveToStorage, clearStorage } from './persist'
import { NDA_FREQ_DEFAULT } from '../lib/ndaFreq'

// ─── Initial / default state ────────────────────────────────
const DEFAULTS = {
  exams: [],
  studentProfiles: {},
  savedInsights: { classReport: null, studentPlans: {} },
  ndaFreq: NDA_FREQ_DEFAULT,
  costLog: [],
  apiKey: '',
}

// Merge saved data with defaults (handles missing keys from old versions)
function hydrate() {
  const saved = loadFromStorage()
  if (!saved) return { ...DEFAULTS }
  return {
    ...DEFAULTS,
    ...saved,
    savedInsights: { ...DEFAULTS.savedInsights, ...saved.savedInsights },
    ndaFreq: saved.ndaFreq?.length ? saved.ndaFreq : NDA_FREQ_DEFAULT,
  }
}

// ─── Store ───────────────────────────────────────────────────
const useStore = create((set, get) => ({
  // ── Data state ──────────────────────────────────────────
  ...hydrate(),

  // ── UI state ────────────────────────────────────────────
  activePage: 'dashboard',
  activeStudent: null,
  uploadModalOpen: false,

  // ── Helpers ─────────────────────────────────────────────
  _save() {
    saveToStorage(get())
  },

  // ── Navigation ──────────────────────────────────────────
  setActivePage(page) {
    set({ activePage: page, activeStudent: null })
  },

  setActiveStudent(name) {
    set({ activeStudent: name, activePage: 'students' })
  },

  // ── Upload modal ─────────────────────────────────────────
  openUploadModal() { set({ uploadModalOpen: true }) },
  closeUploadModal() { set({ uploadModalOpen: false }) },

  // ── Exams ────────────────────────────────────────────────
  addExam(exam) {
    set(s => ({ exams: [...s.exams, { ...exam, batch: exam.batch || null }] }))
    get()._save()
  },

  replaceExam(id, exam) {
    set(s => ({ exams: s.exams.map(e => e.id === id ? exam : e) }))
    get()._save()
  },

  updateQuestion(examId, qNum, patch) {
    set(s => ({
      exams: s.exams.map(e => {
        if (e.id !== examId) return e
        return {
          ...e,
          questions: e.questions.map(q =>
            q.q === qNum ? { ...q, ...patch } : q
          )
        }
      })
    }))
    get()._save()
  },

  // ── Student profiles ─────────────────────────────────────
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

  // ── Insights ────────────────────────────────────────────
  saveClassReport(text) {
    set(s => ({
      savedInsights: {
        ...s.savedInsights,
        classReport: { text, generatedAt: new Date().toISOString() }
      }
    }))
    get()._save()
  },

  saveStudentPlan(name, text) {
    set(s => ({
      savedInsights: {
        ...s.savedInsights,
        studentPlans: {
          ...s.savedInsights.studentPlans,
          [name]: { text, generatedAt: new Date().toISOString() }
        }
      }
    }))
    get()._save()
  },

  clearClassReport() {
    set(s => ({
      savedInsights: { ...s.savedInsights, classReport: null }
    }))
    get()._save()
  },

  clearStudentPlan(name) {
    set(s => {
      const plans = { ...s.savedInsights.studentPlans }
      delete plans[name]
      return { savedInsights: { ...s.savedInsights, studentPlans: plans } }
    })
    get()._save()
  },

  // ── NDA Frequency table ──────────────────────────────────
  setNdaFreq(rows) {
    set({ ndaFreq: rows })
    get()._save()
  },

  resetNdaFreq() {
    set({ ndaFreq: NDA_FREQ_DEFAULT })
    get()._save()
  },

  // ── API key ──────────────────────────────────────────────
  setApiKey(key) {
    set({ apiKey: key })
    get()._save()
  },

  // ── Cost log ─────────────────────────────────────────────
  recordCost(entry) {
    set(s => ({ costLog: [...s.costLog, entry] }))
    get()._save()
  },

  clearCostLog() {
    set({ costLog: [] })
    get()._save()
  },

  // ── Export / Import ──────────────────────────────────────
  exportDB() {
    const { exams, studentProfiles, savedInsights, ndaFreq, costLog, apiKey } = get()
    const json = JSON.stringify(
      { exams, studentProfiles, savedInsights, ndaFreq, costLog, apiKey },
      null, 2
    )
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nda_tracker_${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  },

  importDB(json) {
    try {
      const data = JSON.parse(json)
      if (!data.exams) throw new Error('Invalid backup file')

      const current = get()
      // Merge exams — no duplicates
      const existingIds = new Set(current.exams.map(e => e.id))
      const newExams = [...current.exams]
      data.exams.forEach(e => { if (!existingIds.has(e.id)) newExams.push(e) })

      // Merge insights
      const insights = { ...current.savedInsights }
      if (data.savedInsights?.classReport) insights.classReport = data.savedInsights.classReport
      if (data.savedInsights?.studentPlans) {
        insights.studentPlans = {
          ...insights.studentPlans,
          ...data.savedInsights.studentPlans
        }
      }

      set({
        exams: newExams,
        savedInsights: insights,
        ...(data.apiKey && !current.apiKey ? { apiKey: data.apiKey } : {}),
        ...(data.ndaFreq?.length ? { ndaFreq: data.ndaFreq } : {}),
      })
      get()._save()

      const planCount = Object.keys(data.savedInsights?.studentPlans || {}).length
      return { exams: newExams.length, plans: planCount }
    } catch (e) {
      throw new Error('Import failed: ' + e.message)
    }
  },

  // ── Load remote data (GitHub Pages read-only mode) ───────
  loadRemoteData(data) {
    if (!data) return
    set({
      exams: data.exams || [],
      studentProfiles: data.studentProfiles || {},
      savedInsights: data.savedInsights || DEFAULTS.savedInsights,
      ndaFreq: data.ndaFreq?.length ? data.ndaFreq : NDA_FREQ_DEFAULT,
      costLog: data.costLog || [],
    })
  },

  // ── Clear all ────────────────────────────────────────────
  clearAll() {
    clearStorage()
    set({ ...DEFAULTS, activePage: 'dashboard', activeStudent: null, uploadModalOpen: false })
  },
}))

export default useStore
