const KEY = 'nda_tracker_v2'

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveToStorage(state) {
  try {
    // Only persist data fields, not UI state
    const { exams, studentProfiles, savedInsights, ndaFreq, costLog, apiKey } = state
    localStorage.setItem(KEY, JSON.stringify({
      exams, studentProfiles, savedInsights, ndaFreq, costLog, apiKey
    }))
  } catch (e) {
    console.error('Storage save failed:', e)
  }
}

export function clearStorage() {
  localStorage.removeItem(KEY)
}
