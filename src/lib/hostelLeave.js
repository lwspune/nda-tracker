import { OPEN_LEAVE_TO_TS } from '../store/slices/leavesSlice'

// Open-leave review, shared by the admin Hostel board and the warden's own
// capture page.
//
// The stale flag is the guard against the persist-until-return model's one
// failure mode: an open-ended leave nobody closes silently explains every
// checkpoint for that boarder, forever. Whoever can OPEN a leave needs to see
// this list, which is why it isn't admin-only.

// A leave open this many days or more is flagged for review.
export const STALE_LEAVE_DAYS = 3

const DAY_MS = 86_400_000

// Anything at/after this instant is "open-ended". Open leaves are encoded as a
// far-future sentinel rather than NULL so stale bundles still read them, but
// NULL rows predate that encoding and are equally open — test for both.
export const OPEN_LEAVE_MS = Date.parse(OPEN_LEAVE_TO_TS)

// rows        — `leaves` rows overlapping the day ({ id, lws_id, from_ts, to_ts })
// nameByLwsId — Map of roster lwsId → name; rows outside it are dropped
// dayStartMs  — epoch ms of the board day's start (IST midnight)
//
// Returns [{ id, lwsId, name, fromIso, daysOut, stale, openEnded }],
// longest-out first so the ones needing review surface at the top.
export function buildOpenLeaveList({ rows, nameByLwsId, dayStartMs }) {
  const names = nameByLwsId instanceof Map ? nameByLwsId : new Map(Object.entries(nameByLwsId ?? {}))
  return (rows ?? [])
    .filter(r => r?.lws_id && names.has(r.lws_id))
    .map(r => {
      const fromMs = Date.parse(r.from_ts)
      // Clamp at 0 — a leave starting tomorrow is not "-1 days out".
      const daysOut = Math.max(0, Math.floor((dayStartMs - fromMs) / DAY_MS))
      return {
        id: r.id,
        lwsId: r.lws_id,
        name: names.get(r.lws_id),
        fromIso: String(r.from_ts ?? '').slice(0, 10),
        daysOut,
        stale: daysOut >= STALE_LEAVE_DAYS,
        openEnded: r.to_ts == null || Date.parse(r.to_ts) >= OPEN_LEAVE_MS,
      }
    })
    .sort((a, b) => b.daysOut - a.daysOut || String(a.name).localeCompare(String(b.name)))
}
