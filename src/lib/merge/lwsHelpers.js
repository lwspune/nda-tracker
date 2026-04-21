// ── LWS ID helpers ────────────────────────────────────────────

function lwsNum(id) {
  const m = String(id || '').match(/LWS-(\d+)/i)
  return m ? parseInt(m[1], 10) : 0
}

/**
 * Returns the next sequential LWS ID based on the highest existing one.
 * e.g. if students have LWS-001 … LWS-353, returns 'LWS-354'.
 */
export function nextLwsId(students) {
  const max = students.reduce((acc, s) => Math.max(acc, lwsNum(s.lws_id)), 0)
  return `LWS-${String(max + 1).padStart(3, '0')}`
}
