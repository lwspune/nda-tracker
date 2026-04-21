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
}

// Merge saved data with defaults (handles missing keys from old versions)
export function hydrate() {
  const saved = loadFromStorage()
  if (!saved) return { ...DEFAULTS }
  const { apiKey: _dropped, ...safeFields } = saved // never restore apiKey from storage
  return {
    ...DEFAULTS,
    ...safeFields,
    savedInsights:     { ...DEFAULTS.savedInsights, ...saved.savedInsights },
    ndaFreqBySubject:  migrateFreq(saved),
    ndaMarksBySubject: migrateMarks(saved),
  }
}
