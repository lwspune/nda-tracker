// ── Storage backend ────────────────────────────────────────────
// Dev mode  (npm run dev):  reads/writes data/faculty-data.json via the Vite
//                           dev plugin. No size limit. Survives browser clears.
// Prod mode (Vercel):       reads/writes Supabase faculty_state table when a
//                           faculty session is active (teacher/student skipped).
// ──────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase'

const IS_DEV = import.meta.env.DEV
const API    = '/api/data'

// ── Supabase helpers (prod faculty mode) ─────────────────────

export async function loadFromSupabase() {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('faculty_state').select('data').eq('id', 1).single()
  if (error) return null
  return data?.data ?? null
}

export function saveToSupabase(data) {
  if (!supabase) return
  supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) return
    const { error } = await supabase.from('faculty_state')
      .update({ data, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (error) console.error('[persist] Supabase save failed:', error)
  })
}

// ── Sync load (unused in prod — kept for legacy LS migration guard) ──────────
export function loadFromStorage() {
  if (IS_DEV) return null
  try {
    const raw = localStorage.getItem('nda_tracker_v2')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// ── Async load (dev: file plugin, prod: Supabase) ─────────────
export async function loadFromDisk() {
  if (IS_DEV) {
    try {
      const r = await fetch(API)
      if (!r.ok) return null
      const text = await r.text()
      return text && text !== 'null' ? JSON.parse(text) : null
    } catch {
      return null
    }
  }
  return loadFromSupabase()
}

// ── Save ──────────────────────────────────────────────────────
// apiKey is intentionally excluded — kept in memory only.
export function saveToStorage(state) {
  const {
    exams, studentProfiles, savedInsights, ndaFreqBySubject, ndaMarksBySubject, costLog, lastDeployedAt,
    syllabusPrograms, syllabusBatches, syllabusBatchBranches, batchProgramAssignments, batchSyllabusProgress,
    batchChapterTimelines,
    timetableTeachers, timetableMappings, timetables, examSchedules,
    whatsappSendHistory,
  } = state
  const data = {
    exams, studentProfiles, savedInsights, ndaFreqBySubject, ndaMarksBySubject, costLog, lastDeployedAt,
    syllabusPrograms, syllabusBatches, syllabusBatchBranches, batchProgramAssignments, batchSyllabusProgress,
    batchChapterTimelines,
    timetableTeachers, timetableMappings, timetables, examSchedules,
    whatsappSendHistory,
  }

  if (IS_DEV) {
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(e => console.error('[persist] Save to disk failed:', e))
    return
  }

  saveToSupabase(data)
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
  if (supabase) {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      supabase.from('faculty_state').update({ data: null }).eq('id', 1)
    })
  }
}
