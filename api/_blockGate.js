// The server-side floor for "never message a blocked contact".
//
// The rule — no WhatsApp send may reach a Block / Quit / Inactive student — was
// enforced ONLY in the browser for three of the five send flows until
// 2026-09-12. `send-late-notifications`, `send-homework-pending` and
// `send-exam-absence` looped straight over `req.body.students[]` and never read
// the `students` table, so the preview modal's filter was the only thing between
// a blocked family and a message. 87 of 329 students are `Block`, so the gate
// fires on more than a quarter of the roster every send.
//
// This is a FLOOR, not the whole policy. A client may be stricter — the exam
// absence preview deliberately requires `=== 'Active'` and drops profile-less
// rows, which is a decision recorded in that component. The server's job is only
// to make the minimum impossible to bypass.
//
// Keyed on `lws_id`: all four flows already carry `lwsId` on their rows, so
// unlike `send-whatsapp.js` (which works from exam-result names) there is no
// name-variant matching to get wrong.
//
// Underscore-prefixed: Vercel does not count it against the 12-function Hobby
// cap, but api/__tests__/importGraph.test.js still walks it, so relative
// imports here need their file extensions.

import { isBlockedStatus } from '../src/lib/accountStatus.js'

// Thrown when the status read itself fails. Callers must turn this into a 500
// and send NOTHING — see the fail-closed note below.
export class BlockGateReadError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BlockGateReadError'
  }
}

/**
 * Which of these students must not be messaged.
 *
 * Two rules, deliberately different from each other:
 *
 *   - **Not found → send** (fail OPEN). Mirrors `isBlockedStatus`, which treats
 *     a blank/legacy status as active, and the login gate it was modelled on. A
 *     student with no profile row must not be silently muted.
 *
 *   - **Read error → refuse the whole send** (fail CLOSED, by throwing).
 *     Mirrors the lecture-miss alert's leaves-read behaviour. Failing open here
 *     would make the guard disappear at exactly the moment it is needed, which
 *     is the live defect in `send-whatsapp.js` — it destructures only `{ data }`
 *     and never inspects the error, so a failed read passes everyone.
 *
 * @param {object} supabase JWT-scoped client (respects RLS)
 * @param {string[]} lwsIds ids from the request's students[]
 * @returns {Promise<Set<string>>} the subset that is blocked
 */
export async function loadBlockedLwsIds(supabase, lwsIds) {
  const ids = [...new Set((lwsIds ?? []).filter(Boolean).map(String))]
  if (ids.length === 0) return new Set()

  const { data, error } = await supabase
    .from('students')
    .select('lws_id, account_status')
    .in('lws_id', ids)

  if (error) throw new BlockGateReadError(`Could not verify account status: ${error.message}`)
  // A resolve with neither data nor error should be impossible, but treating it
  // as "nobody is blocked" is the same silent failure this exists to prevent.
  if (!Array.isArray(data)) throw new BlockGateReadError('Could not verify account status: no rows returned')

  const blocked = new Set()
  for (const row of data) {
    if (row?.lws_id && isBlockedStatus(row.account_status)) blocked.add(row.lws_id)
  }
  return blocked
}

/**
 * Split request rows into those that may be messaged and those that may not.
 * Rows without an `lwsId` pass through (fail open — same rule as not-found).
 */
export async function partitionBlocked(supabase, rows) {
  const list = Array.isArray(rows) ? rows : []
  const blockedIds = await loadBlockedLwsIds(supabase, list.map(r => r?.lwsId))
  const allowed = [], blocked = []
  for (const row of list) {
    if (row?.lwsId && blockedIds.has(row.lwsId)) blocked.push(row)
    else allowed.push(row)
  }
  return { allowed, blocked }
}
