import { isBlockedStatus } from './accountStatus'

// The students in `batchName` whose portal access is worth revoking when the batch
// is retired — i.e. those who can currently log in.
//
// The predicate is the shared `isBlockedStatus` block-set, NOT analytics' stricter
// `=== 'Active'`: api/student-login fails OPEN on a blank status, so a legacy row
// that was never stamped 'Active' CAN still sign in and must be included, or
// archiving would quietly leave those students access. Already Block / Quit /
// Inactive rows are skipped — blocking them gains nothing and would overwrite a
// more specific status with a vaguer one.
//
// `p.name === key` skips variant-keyed entries: studentProfiles is indexed by
// canonical name AND every name variant, so a student with variants would
// otherwise appear more than once.
//
// Returns [{ lwsId, name }] sorted by name, so the confirm list is stable.
export function getBlockableMembers(studentProfiles, batchName) {
  if (!batchName) return []
  const out = []
  for (const [key, p] of Object.entries(studentProfiles ?? {})) {
    if (!p || p.name !== key) continue
    if (!p.lwsId) continue                       // nothing to update
    if (!(p.batches ?? []).includes(batchName)) continue
    if (isBlockedStatus(p.accountStatus)) continue
    out.push({ lwsId: p.lwsId, name: p.name })
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}
