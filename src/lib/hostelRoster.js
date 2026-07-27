// Who counts as a boarder, for hostel & mess capture.
//
// Extracted from HostelTab so the admin board and the staff-facing
// /hostel-mess-attendance surface can never drift on who is in scope — a
// disagreement there would show up as boarders silently missing from one
// marking list, which is exactly the kind of gap this subsystem exists to
// catch. The warden-alert endpoint applies the same predicate server-side
// (branch + account_status + residential), so all three agree.

// Branches that have a hostel. Today just APJ — LWS Pune has no boarders
// (confirmed 2026-07-27). Note `residential` cannot carry this scope on its
// own: it is true for 325 of 326 students, including every LWS Pune row, so
// the BRANCH filter is what actually bounds the cohort. Do not drop it
// expecting `residential` to hold the line.
export const HOSTEL_BRANCHES = ['APJ']

// Returns [{ lwsId, name, branch, gender, batches, mobile, parentMobiles }]
// sorted by name. `studentProfiles` is keyed by canonical name AND by every
// name variant pointing at the same entry, so the `p.name !== key` guard is
// what stops one student appearing twice under a sheet spelling.
export function buildBoarderRoster(studentProfiles, branches = HOSTEL_BRANCHES) {
  const wanted = new Set(branches || [])
  const out = []
  for (const [key, p] of Object.entries(studentProfiles || {})) {
    if (!p || p.name !== key) continue                  // variant-keyed entry
    if (!wanted.has(p.branch)) continue
    if (p.accountStatus && p.accountStatus !== 'Active') continue
    if (p.residential === false) continue               // day-scholar → not a boarder
    out.push({
      lwsId: p.lwsId,
      name: p.name,
      branch: p.branch,
      gender: p.gender,
      batches: p.batches || [],
      mobile: p.mobile || '',
      parentMobiles: p.parentMobiles || [],
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
