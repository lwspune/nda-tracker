// ── Storage backend ────────────────────────────────────────────
// Dev mode  (npm run dev):  reads/writes data/faculty-data.json via the Vite
//                           dev plugin. No size limit. Survives browser clears.
// Prod mode (Vercel):       reads/writes Supabase faculty_state table when a
//                           faculty session is active (teacher/student skipped).
// ──────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase'
import { IS_READ_ONLY } from '../config'

// `IS_READ_ONLY` is a runtime hostname check — `true` on Vercel/GitHub Pages, `false` on localhost.
// We deliberately avoid `import.meta.env.DEV` here because Vite 8.0.3 + Rolldown on Vercel was
// observed to substitute it with `true` in production builds (DCE inverted the dev/prod branches),
// causing the prod app to fetch the dev-only `/api/data` endpoint and 404. The runtime check is
// evaluated each load and can't be miscompiled.
const IS_DEV = !IS_READ_ONLY
const API = '/api/data'

// ── Supabase helpers (prod admin mode) ───────────────────────

export async function loadFromSupabase() {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('faculty_state').select('data').eq('id', 1).single()
  if (error) return null
  return data?.data ?? null
}

// Fetches all rows from a table, paginating past Supabase's default 1000-row limit.
async function fetchAllRows(table) {
  const PAGE = 1000
  const rows = []
  let from = 0
  while (true) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    rows.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return { data: rows, error: null }
}

// Loads class_reports + student_plans, collapses to "latest per scope" — matches the existing
// in-memory shape: { classReport: { text, generatedAt } | null, studentPlans: { [name]: { text, generatedAt } } }.
// History rows stay in the DB for future surfaces (timeline, audit, etc.) but the store only holds the latest.
export async function loadInsightsFromSupabase() {
  if (!supabase) return null

  const { data: reportRows, error: reportsErr } = await supabase
    .from('class_reports').select('text, generated_at').order('generated_at', { ascending: false }).limit(1)
  if (reportsErr) return null

  const { data: planRows, error: plansErr } = await supabase
    .from('student_plans').select('student_name, text, generated_at').order('generated_at', { ascending: false })
  if (plansErr) return null

  const classReport = reportRows?.[0]
    ? { text: reportRows[0].text, generatedAt: reportRows[0].generated_at }
    : null

  const studentPlans = {}
  for (const p of planRows ?? []) {
    if (!studentPlans[p.student_name]) {
      studentPlans[p.student_name] = { text: p.text, generatedAt: p.generated_at }
    }
  }

  return { classReport, studentPlans }
}

export async function loadExamsFromSupabase() {
  if (!supabase) return null

  const { data: examRows, error: examsErr } = await fetchAllRows('exams')
  if (examsErr) return null
  const { data: resultRows, error: resultsErr } = await fetchAllRows('exam_results')
  if (resultsErr) return null

  const resultsByExam = {}
  for (const r of resultRows) {
    if (!resultsByExam[r.exam_id]) resultsByExam[r.exam_id] = []
    resultsByExam[r.exam_id].push({
      name:         r.student_name,
      rollNo:       r.roll_no       ?? '',
      totalMarks:   r.total_marks   ?? 0,
      correct:      r.correct       ?? 0,
      incorrect:    r.incorrect     ?? 0,
      notAttempted: r.not_attempted ?? 0,
      responses:    r.responses     ?? {},
    })
  }

  return examRows.map(row => ({
    id:        row.id,
    name:      row.name,
    date:      row.date,
    subject:   row.subject,
    batch:     row.batch,
    branch:    row.branch,
    marking:   row.marking   ?? { correct: 4, wrong: -1 },
    questions: row.questions ?? [],
    createdAt: row.created_at,
    students:  resultsByExam[row.id] ?? [],
  }))
}

// Loads all quiz rows from the normalised `quizzes` table → camelCase, matching
// the in-store shape (mirrors loadExamsFromSupabase). Attempts are NOT loaded here
// (per-quiz fetch in the response dashboard, Phase 3).
export async function loadQuizzesFromSupabase() {
  if (!supabase) return null
  const { data, error } = await fetchAllRows('quizzes')
  if (error) return null
  return data.map(row => ({
    id:        row.id,
    title:     row.title,
    subject:   row.subject,
    batch:     row.batch,
    branch:    row.branch,
    marking:   row.marking   ?? { correct: 1, wrong: 0 },
    questions: row.questions ?? [],
    opensAt:   row.opens_at,
    closesAt:  row.closes_at,
    status:    row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }))
}

export function saveToSupabase(data) {
  if (!supabase) return
  supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) return
    // exams + quizzes + savedInsights live in normalised tables — exclude from the JSONB blob
    const { exams: _exams, quizzes: _quizzes, savedInsights: _insights, ...rest } = data
    const { error } = await supabase.from('faculty_state')
      .update({ data: rest, updated_at: new Date().toISOString() })
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
    exams, quizzes, studentProfiles, savedInsights, ndaFreqBySubject, ndaMarksBySubject, costLog, lastDeployedAt,
    syllabusPrograms, syllabusBatches, syllabusBatchBranches, batchProgramAssignments, batchSyllabusProgress,
    batchChapterTimelines,
    timetableTeachers, timetableMappings, timetables, examSchedules,
    whatsappSendHistory, lateSendHistory, lectureMissSendHistory, examAbsenceSendHistory, homeworkSendHistory, branches,
  } = state
  const data = {
    exams, quizzes, studentProfiles, savedInsights, ndaFreqBySubject, ndaMarksBySubject, costLog, lastDeployedAt,
    syllabusPrograms, syllabusBatches, syllabusBatchBranches, batchProgramAssignments, batchSyllabusProgress,
    batchChapterTimelines,
    timetableTeachers, timetableMappings, timetables, examSchedules,
    whatsappSendHistory, lateSendHistory, lectureMissSendHistory, examAbsenceSendHistory, homeworkSendHistory, branches,
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
