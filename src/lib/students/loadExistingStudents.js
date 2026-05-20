import { supabase } from '../supabase'

/**
 * Returns the existing students array in the snake_case shape that
 * mergeStudents() consumes (`{ lws_id, canonical_name, mobile, eis_reg_no,
 * name_variants, batches, parent_mobiles, ... }`).
 *
 * Dual-path:
 *   - Supabase faculty session active → reads from normalised tables
 *   - Otherwise → fetches /api/students-db (Vite dev plugin)
 *   - On any failure → returns []
 *
 * The import flow on Vercel previously fetched /api/students-db unconditionally,
 * which 404s in prod and silently set the existing list to [] — making every
 * row in the Excel look "new" and creating duplicate Supabase rows on confirm.
 */
export async function loadExistingStudents() {
  if (supabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const { data, error } = await supabase
          .from('students')
          .select('*, student_batches(batch_name)')
        if (!error && data) {
          return data.map(s => ({
            ...s,
            batches: (s.student_batches || []).map(b => b.batch_name),
            student_batches: undefined,
          }))
        }
      }
    } catch (_) { /* fall through */ }
  }

  try {
    const db = await fetch('/api/students-db').then(r => r.json())
    return db?.students || []
  } catch (_) {
    return []
  }
}
