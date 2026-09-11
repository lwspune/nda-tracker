// Dashboard "never logged in" — active students who have never opened the student
// portal. Pure: the slice fetches the set of lws_ids that have ever logged in;
// this subtracts them from the current roster and orders the chase list.
//
// Cohort predicate is `isBlockedStatus` (the Block/Quit/Inactive block-set,
// fail-open on blank) — NOT the stricter `=== 'Active'` used by the attendance
// leaders. This widget measures the login door, and that door
// (api/student-login.js) denies only those three statuses and lets blank/legacy
// rows through. A blank-status student who *can* log in but hasn't belongs on the
// chase list; `=== 'Active'` would silently drop them.
//
// `today` is injected so the module never reads the clock (and the tests are
// deterministic). Callers in the app pass nothing and get the real date.

import { isBlockedStatus } from '../accountStatus'

const DAY_MS = 86400000

/** Whole days between an ISO YYYY-MM-DD date and `today`; null when undated. */
function daysBetween(isoDate, today) {
  if (!isoDate) return null
  const then = Date.parse(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(then)) return null
  return Math.round((today.getTime() - then) / DAY_MS)
}

/**
 * @param {Object}      args
 * @param {Set|Array}   args.loginIds        lws_ids that have logged in at least once
 * @param {Object}      args.studentProfiles canonical+variant keyed profile map
 * @param {Date}        [args.today]         injected clock (defaults to now)
 * @returns {Array} [{ lwsId, name, branch, batches, regDate, daysEnrolled, contactCount }]
 *                  longest-enrolled first; undated students last.
 */
export function buildNeverLoggedIn({ loginIds, studentProfiles, today = new Date() } = {}) {
  const seen = loginIds instanceof Set ? loginIds : new Set(loginIds || [])
  const out = []
  const emitted = new Set()

  for (const [key, p] of Object.entries(studentProfiles || {})) {
    if (!p || p.name !== key) continue              // skip variant-keyed duplicates
    if (!p.lwsId) continue                          // cannot be matched to a login row
    if (isBlockedStatus(p.accountStatus)) continue  // blocked accounts cannot log in
    if (seen.has(p.lwsId)) continue                 // has logged in at least once
    if (emitted.has(p.lwsId)) continue

    emitted.add(p.lwsId)
    out.push({
      lwsId:        p.lwsId,
      name:         p.name,
      branch:       p.branch || '',
      batches:      p.batches || [],
      regDate:      p.regDate || '',
      daysEnrolled: daysBetween(p.regDate, today),
      // The portal authenticates by mobile number (own OR parent), so a student
      // with zero numbers on file is locked out by construction, not reluctant.
      contactCount: (p.mobile ? 1 : 0) + (p.parentMobiles?.length || 0),
    })
  }

  // Longest-enrolled first; undated rows last, then alphabetical.
  return out.sort((a, b) => {
    if (!a.regDate && !b.regDate) return a.name.localeCompare(b.name)
    if (!a.regDate) return 1
    if (!b.regDate) return -1
    return a.regDate.localeCompare(b.regDate) || a.name.localeCompare(b.name)
  })
}
