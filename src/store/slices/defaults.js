import { loadFromStorage } from '../persist'
import { IS_READ_ONLY } from '../../config'
import { buildDefaultFreqBySubject, buildDefaultMarksBySubject } from '../../lib/ndaFreq'
import { migrateFreq, migrateMarks } from '../../lib/persistence'

export const DEFAULTS = {
  exams: [],
  quizzes: [],
  studentProfiles: {},
  studentList: [],
  savedInsights: { classReport: null, studentPlans: {} },
  ndaFreqBySubject:  buildDefaultFreqBySubject(),
  ndaMarksBySubject: buildDefaultMarksBySubject(),
  costLog: [],
  apiKey: '',
  lastDeployedAt: null,
  hydrated: IS_READ_ONLY,
  isSuperadmin: false, // session-derived (user_metadata.role==='superadmin'); never persisted

  syllabusPrograms: [],
  syllabusBatches: [],
  syllabusBatchBranches: {},
  batchProgramAssignments: {},
  batchSyllabusProgress: {},
  timetableTeachers: [],
  timetableMappings: [],
  timetables: [],
  whatsappSendHistory: {},
  lateSendHistory: {},
  lectureMissSendHistory: {},
  examAbsenceSendHistory: {},
  homeworkSendHistory: {},
  branches: [],
}

// Merge saved data with defaults (handles missing keys from old versions)
export function hydrate() {
  const saved = loadFromStorage()
  if (!saved) return { ...DEFAULTS }
  const { apiKey: _dropped, ...safeFields } = saved // never restore apiKey from storage
  return {
    ...DEFAULTS,
    ...safeFields,
    savedInsights:           { ...DEFAULTS.savedInsights, ...saved.savedInsights },
    ndaFreqBySubject:        migrateFreq(saved),
    ndaMarksBySubject:       migrateMarks(saved),
    syllabusPrograms:        saved.syllabusPrograms || [],
    // Migration: if syllabusBatches not stored yet, seed from existing assignment keys
    syllabusBatches:         saved.syllabusBatches?.length
                               ? saved.syllabusBatches
                               : Object.keys(saved.batchProgramAssignments || {}),
    syllabusBatchBranches:   saved.syllabusBatchBranches || {},
    batchProgramAssignments: saved.batchProgramAssignments || {},
    batchSyllabusProgress:   saved.batchSyllabusProgress || {},
    timetableTeachers:       saved.timetableTeachers || [],
    timetableMappings:       saved.timetableMappings || [],
    timetables:              saved.timetables || [],
    branches:                seedBranches(saved),
  }
}

// First-load seed for the canonical branches[] list: union of branch values
// already present on timetables and in syllabusBatchBranches. After the
// first save the user-managed `branches[]` is authoritative — this seed
// only runs while the field is empty.
export function seedBranches(saved) {
  if (saved?.branches?.length) return saved.branches
  const fromTimetables = (saved?.timetables || []).map(t => t.branch).filter(Boolean)
  const fromSyllabus   = Object.values(saved?.syllabusBatchBranches || {}).filter(Boolean)
  return [...new Set([...fromTimetables, ...fromSyllabus])]
}
