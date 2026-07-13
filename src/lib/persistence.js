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
