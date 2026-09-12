// The recipient list every parent-facing send preview builds — and the client
// half of the blocked-contact gate.
//
// Extracted 2026-09-12 from three byte-similar copies in
// LateNotificationPreviewModal, LectureMissPreviewModal and
// HomeworkPreviewModal. Each built the same lwsId index, applied the same
// isBlockedStatus skip, and emitted the same {lwsId, name, mobile,
// parentMobiles} row, which meant the rule "never message a Block / Quit /
// Inactive contact" lived in three places a fourth flow could simply forget.
//
// This is the PREVIEW's copy of the rule, not the enforcement point: the
// endpoints now apply the same floor server-side (api/_blockGate.js), so a
// client that skipped this can no longer reach a blocked family. Keeping it
// here as well means the preview shows what will actually go out rather than
// listing people the server will silently drop.
//
// Deliberately NOT used by ExamAbsencePreviewModal. That flow requires
// `accountStatus === 'Active'` and drops profile-less rows — a stricter policy
// stated in the component ("we never send absence alerts to non-EIS or
// non-Active students"). Folding it in here would quietly relax it.

import { isBlockedStatus } from './accountStatus'

// studentProfiles is keyed by name AND by every name variant, so one student
// appears under several keys. Collapse to one entry per lwsId; first wins.
export function indexProfilesByLwsId(studentProfiles) {
  const byLwsId = {}
  for (const p of Object.values(studentProfiles ?? {})) {
    if (p?.lwsId && !byLwsId[p.lwsId]) byLwsId[p.lwsId] = p
  }
  return byLwsId
}

/**
 * Contact rows for a send preview, with blocked contacts removed.
 *
 * Fails OPEN in both directions, matching the login gate and the server floor:
 * a blank/legacy status is treated as active, and an id with no profile is
 * kept (the server does its own check, and dropping it here would silently
 * mute a real student).
 *
 * @param {string[]} lwsIds        ids to build rows for, in display order
 * @param {object} studentProfiles the store's name-keyed profile map
 * @param {(lwsId: string) => object} [extraFor] per-flow extra fields
 *        (`items` for homework, `subjects` for lecture-miss). Cannot overwrite
 *        the contact fields — those are what the send actually uses.
 * @returns {Array<{lwsId,name,mobile,parentMobiles}>} `parentMobiles` is a
 *        comma-space STRING, because the preview renders it as one editable
 *        field; callers split it again when posting.
 */
export function buildRecipientRows(lwsIds, studentProfiles, extraFor) {
  if (!Array.isArray(lwsIds)) return []
  const byLwsId = indexProfilesByLwsId(studentProfiles)
  const out = []
  for (const lwsId of lwsIds) {
    const p = byLwsId[lwsId]
    if (p && isBlockedStatus(p.accountStatus)) continue   // never message a blocked contact
    const extra = typeof extraFor === 'function' ? (extraFor(lwsId) ?? {}) : {}
    out.push({
      ...extra,
      lwsId,
      name:          p?.name ?? lwsId,
      mobile:        p?.mobile ?? '',
      parentMobiles: (p?.parentMobiles ?? []).join(', '),
    })
  }
  return out
}
