import { create } from 'zustand'
import { loadFromDisk, saveToStorage, clearStorage, loadExamsFromSupabase as fetchExamsFromSupabase, loadInsightsFromSupabase as fetchInsightsFromSupabase } from './persist'
import { supabase } from '../lib/supabase'
import { IS_READ_ONLY } from '../config'
import { migrateFreq, exportDB, importDB } from '../lib/persistence'
import { DEFAULTS, hydrate, seedBranches } from './slices/defaults'
import { createExamsSlice } from './slices/examsSlice'
import { createStudentSlice } from './slices/studentSlice'
import { createInsightsSlice } from './slices/insightsSlice'
import { createNdaSlice } from './slices/ndaSlice'
import { createSyllabusSlice } from './slices/syllabusSlice'
import { createTimetableSlice } from './slices/timetableSlice'
import { createAttendanceSlice } from './slices/attendanceSlice'
import { createLectureAbsenceSlice } from './slices/lectureAbsenceSlice'
import { createHomeworkSlice }       from './slices/homeworkSlice'
import { createTeacherFeedbackSlice } from './slices/teacherFeedbackSlice'
import { createExamAbsenceSlice }    from './slices/examAbsenceSlice'
import { createConfigSlice } from './slices/configSlice'
import { createMonthlyReportSlice } from './slices/monthlyReportSlice'

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
    // Runtime hostname check — see persist.js for why we avoid import.meta.env.DEV here
    if (IS_READ_ONLY) {
      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          set({
            hydrated: false,
            isSuperadmin: session.user?.user_metadata?.role === 'superadmin',
          })
          const saved = await loadFromDisk()
          if (saved) {
            // exams are now in normalised tables — exclude stale JSONB copy
            const { apiKey: _dropped, exams: _staleExams, ...safeFields } = saved
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
              branches:                seedBranches(saved),
              hydrated: true,
            })
            // Load fresh data from normalised Supabase tables.
            get().loadStudentsFromSupabase()
            get().loadExamsFromSupabase()
            get().loadInsightsFromSupabase()
          } else {
            set({ hydrated: true })
            get().loadStudentsFromSupabase()
            get().loadExamsFromSupabase()
            get().loadInsightsFromSupabase()
          }
          return
        }
      }
      set({ hydrated: true })
      return
    }

    // Dev (localhost) admin has full local access — including the superadmin-only
    // Teacher Feedback surface (data still comes from Supabase under RLS, so it's
    // empty in dev unless a superadmin session exists).
    set({ isSuperadmin: true })
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
        branches:                seedBranches(saved),
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

  // ── Load exams from normalised Supabase tables ───────────
  async loadExamsFromSupabase() {
    const exams = await fetchExamsFromSupabase()
    if (exams !== null) set({ exams })
  },

  // ── Load insights from normalised Supabase tables ─────────
  async loadInsightsFromSupabase() {
    const insights = await fetchInsightsFromSupabase()
    if (insights !== null) set({ savedInsights: insights })
  },

  // ── Load remote data (teacher portal) ────────────────────
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
      branches:                seedBranches(data),
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

  // ── Late-notification send history (faculty only, persisted, keyed by date) ──────
  setLateSendHistory(date, record) {
    if (!date) return
    set(s => ({ lateSendHistory: { ...s.lateSendHistory, [date]: record } }))
    get()._save()
  },

  // ── Lecture-miss send history (faculty only, persisted, keyed by `${date}|${batchName}`) ──────
  // Compound key so two batches sent on the same day stay independent —
  // see decisions log entry for "lectureMissSendHistory compound key".
  setLectureMissSendHistory(key, record) {
    if (!key) return
    set(s => ({ lectureMissSendHistory: { ...s.lectureMissSendHistory, [key]: record } }))
    get()._save()
  },

  // ── Exam-absence send history (admin only, persisted, keyed by examId) ──────
  setExamAbsenceSendHistory(examId, record) {
    if (!examId) return
    set(s => ({ examAbsenceSendHistory: { ...s.examAbsenceSendHistory, [examId]: record } }))
    get()._save()
  },

  // ── Homework send history (admin only, persisted, keyed by `${date}|${batchName}`) ──────
  setHomeworkSendHistory(key, record) {
    if (!key) return
    set(s => ({ homeworkSendHistory: { ...s.homeworkSendHistory, [key]: record } }))
    get()._save()
  },

  // ── Domain slices ─────────────────────────────────────────
  ...createExamsSlice(set, get),
  ...createStudentSlice(set, get),
  ...createInsightsSlice(set, get),
  ...createNdaSlice(set, get),
  ...createSyllabusSlice(set, get),
  ...createTimetableSlice(set, get),
  ...createAttendanceSlice(set, get),
  ...createLectureAbsenceSlice(set, get),
  ...createHomeworkSlice(set, get),
  ...createTeacherFeedbackSlice(set, get),
  ...createExamAbsenceSlice(set, get),
  ...createConfigSlice(set, get),
  ...createMonthlyReportSlice(set, get),
}))

export default useStore
