// ── Storage backend ────────────────────────────────────────────
// Dev mode  (npm run dev):  reads/writes data/faculty-data.json via the Vite
//                           dev plugin. No size limit. Survives browser clears.
// Prod mode (GitHub Pages): falls back to localStorage (student read-only
//                           sessions only — their data is tiny).
// ──────────────────────────────────────────────────────────────

const IS_DEV = import.meta.env.DEV
const LS_KEY = 'nda_tracker_v2'
const API    = '/api/data'

// ── Sync load (prod only) ─────────────────────────────────────
// Returns persisted data or null. Called synchronously during store
// creation — only used in prod. In dev the store starts with DEFAULTS
// and initStore() hydrates asynchronously.
export function loadFromStorage() {
  if (IS_DEV) return null // async path — see loadFromDisk()
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// ── Async load (dev only) ─────────────────────────────────────
// Called by useStore.initStore() after the store is created.
export async function loadFromDisk() {
  try {
    const r = await fetch(API)
    if (!r.ok) return null
    const text = await r.text()
    return text && text !== 'null' ? JSON.parse(text) : null
  } catch {
    return null
  }
}

// ── Save ──────────────────────────────────────────────────────
// apiKey is intentionally excluded — kept in memory only (Bug 1 fix).
export function saveToStorage(state) {
  const { exams, studentProfiles, savedInsights, ndaFreqBySubject, costLog, lastDeployedAt } = state
  const payload = JSON.stringify({ exams, studentProfiles, savedInsights, ndaFreqBySubject, costLog, lastDeployedAt })

  if (IS_DEV) {
    // Fire-and-forget — we never need to await a save
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(e => console.error('[persist] Save to disk failed:', e))
    return
  }

  try {
    localStorage.setItem(LS_KEY, payload)
  } catch (e) {
    console.error('[persist] Storage save failed:', e)
    alert('Warning: Data could not be saved. localStorage may be full. Export your data as a backup.')
  }
}

// ── Clear ─────────────────────────────────────────────────────
export function clearStorage() {
  if (IS_DEV) {
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    }).catch(() => {})
    return
  }
  localStorage.removeItem(LS_KEY)
}
