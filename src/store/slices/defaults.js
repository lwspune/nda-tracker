import { loadFromStorage } from '../persist'
import { buildDefaultFreqBySubject, buildDefaultMarksBySubject } from '../../lib/ndaFreq'
import { migrateFreq, migrateMarks } from '../../lib/persistence'

export const DEFAULTS = {
  exams: [],
  studentProfiles: {},
  savedInsights: { classReport: null, studentPlans: {} },
  ndaFreqBySubject:  buildDefaultFreqBySubject(),
  ndaMarksBySubject: buildDefaultMarksBySubject(),
  costLog: [],
  apiKey: '',
  lastDeployedAt: null,
  hydrated: !import.meta.env.DEV,
  syllabusPrograms: [],
  syllabusBatches: [],
  syllabusBatchBranches: {},
  batchProgramAssignments: {},
  batchSyllabusProgress: {},
  timetableTeachers: [],
  timetableMappings: [],
  timetables: [],
  whatsappSendHistory: {},
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
  }
}
