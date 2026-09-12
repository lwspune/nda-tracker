import { supabase } from '../../lib/supabase'

// The current Supabase session, or null when there is none — which in this app
// also means "we are in dev, writing to data/faculty-data.json via the Vite
// plugin", so every dual-path slice branches on it.
//
// Extracted 2026-09-12 from fifteen identical copies, one at the top of every
// slice. Null when Supabase is not configured at all (`supabase` is a
// null-guarded client), which is what keeps local dev working without env vars.
export async function getSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}
