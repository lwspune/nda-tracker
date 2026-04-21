import { buildDefaultFreqBySubject, buildDefaultMarksBySubject } from './ndaFreq'

// ── Freq migration ────────────────────────────────────────────
// Handles both old (ndaFreq flat array) and new (ndaFreqBySubject object) formats.
// Called during hydration, import, and remote/student data loading.
export function migrateFreq(saved) {
  if (saved.ndaFreqBySubject && typeof saved.ndaFreqBySubject === 'object') {
    // New format — merge with defaults so newly added subjects are present
    return { ...buildDefaultFreqBySubject(), ...saved.ndaFreqBySubject }
  }
  // Old format — ndaFreq was a flat array for Maths only; migrate it
  const base = buildDefaultFreqBySubject()
  if (saved.ndaFreq?.length) base.Maths = saved.ndaFreq
  return base
}

// ── Marks migration ───────────────────────────────────────────
// Handles saves without ndaMarksBySubject (old format) by merging with defaults.
export function migrateMarks(saved) {
  const defaults = buildDefaultMarksBySubject()
  if (saved.ndaMarksBySubject && typeof saved.ndaMarksBySubject === 'object') {
    return { ...defaults, ...saved.ndaMarksBySubject }
  }
  return defaults
}

// ── Export ────────────────────────────────────────────────────
// Serialises the five data fields and triggers a browser download.
export function exportDB({ exams, studentProfiles, savedInsights, ndaFreqBySubject, ndaMarksBySubject, costLog }) {
  const json = JSON.stringify(
    { exams, studentProfiles, savedInsights, ndaFreqBySubject, ndaMarksBySubject, costLog },
    null, 2
  )
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nda_tracker_${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Import ────────────────────────────────────────────────────
// Pure data merge — returns { nextState, result } without touching the store.
// Throws on invalid input so the caller can surface the error.
export function importDB(json, currentState) {
  const data = JSON.parse(json)
  if (!data.exams) throw new Error('Invalid backup file')

  // Merge exams — no duplicates by id
  const existingIds = new Set(currentState.exams.map(e => e.id))
  const newExams = [...currentState.exams]
  data.exams.forEach(e => { if (!existingIds.has(e.id)) newExams.push(e) })

  // Merge insights
  const insights = { ...currentState.savedInsights }
  if (data.savedInsights?.classReport) insights.classReport = data.savedInsights.classReport
  if (data.savedInsights?.studentPlans) {
    insights.studentPlans = { ...insights.studentPlans, ...data.savedInsights.studentPlans }
  }

  const nextState = {
    exams: newExams,
    savedInsights: insights,
    ...(data.apiKey && !currentState.apiKey ? { apiKey: data.apiKey } : {}),
    ...(data.ndaFreqBySubject || data.ndaFreq ? { ndaFreqBySubject: migrateFreq(data) } : {}),
    ...(data.ndaMarksBySubject ? { ndaMarksBySubject: migrateMarks(data) } : {}),
  }

  const planCount = Object.keys(data.savedInsights?.studentPlans || {}).length
  const result = { exams: newExams.length, plans: planCount }

  return { nextState, result }
}
