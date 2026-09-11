// Pulling question content from PYQ Vault, client side.
//
// The browser never holds the institute's bank secret — it posts to our own
// `/api/quiz-import` (kind: 'hydrate-questions') with the admin's Supabase
// session, and the server makes the call outward. See CROSS_APP_SYNC.md.

// Mirrors the bank's MAX_IDS. It REFUSES an over-cap request rather than
// truncating, so a 120-question paper must be chunked here, not clipped there.
export const MAX_IDS = 100

/** The distinct bank ids on an exam, in first-seen order. */
export function bankQuestionIds(exam) {
  const seen = new Set()
  const out = []
  for (const q of (exam && exam.questions) || []) {
    const id = q && q.questionId
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function chunkIds(ids, size = MAX_IDS) {
  const out = []
  for (let i = 0; i < (ids || []).length; i += size) out.push(ids.slice(i, i + size))
  return out
}

/**
 * @returns {Promise<{byId: Object, missing: string[]}>}
 *
 * THROWS on a failed request. "The bank is unreachable" and "the bank has
 * nothing for these" must never look alike — a silent empty result would make
 * a refresh appear to succeed while changing nothing.
 *
 * `missing` carries TWO indistinguishable causes: an id naming no row (a stem
 * repair there is a delete-and-re-commit that mints a new uuid) OR an id naming
 * another institute's PRIVATE row. Report it as "not available from the bank" —
 * never as "this question was repaired".
 */
export async function fetchBankQuestions(ids, { token, fetchImpl = fetch } = {}) {
  const byId = {}
  const missing = []

  for (const chunk of chunkIds(ids || [])) {
    const res = await fetchImpl('/api/quiz-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: 'hydrate-questions', ids: chunk }),
    })
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.json())?.error || '' } catch { /* non-JSON body */ }
      throw new Error(detail || `Could not reach the question bank (${res.status})`)
    }
    const data = await res.json()
    for (const q of data.questions || []) if (q && q.questionId) byId[q.questionId] = q
    for (const id of data.missing || []) missing.push(id)
  }

  return { byId, missing }
}
