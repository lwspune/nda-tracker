// The closed set a scanned sheet is identified against.
//
// Roll numbers are NOT globally unique — measured on the live roster, 12 of 64
// distinct Evalbee rolls are held by more than one student, because they are
// per-batch sequence numbers reused across batches. Within a batch there are
// zero collisions in all five. So the roster handed to `resolveRoll` must be the
// EXAM'S batch and nothing wider; passing the whole school would let a misread
// land on a real student from another cohort, which is the swap the whole
// identity design exists to prevent.
//
// Built from `studentList` (the raw rows) rather than `studentProfiles`, because
// only the raw rows carry `evalbee_roll_nos`.

/**
 * @param {object[]} studentList  raw student rows from the store
 * @param {string[]} batchNames   the exam's batch tags (`getExamBatches`)
 * @returns {{lwsId:string, name:string, evalbeeRollNos:string[], batches:string[]}[]}
 */
export function buildScanRoster(studentList = [], batchNames = []) {
  const wanted = new Set(batchNames.filter(Boolean))
  if (!wanted.size) return []
  return (studentList || [])
    .filter(s => s && s.lws_id)
    // Deliberately NOT filtered by account status. A student blocked after the
    // paper was sat still sat it, and refusing a real sheet is worse here than
    // carrying a few extra names — the roster is already collision-free within
    // a batch, so the wider set costs nothing.
    .filter(s => (s.batches || []).some(b => wanted.has(b)))
    .map(s => ({
      lwsId: s.lws_id,
      name: s.canonical_name || s.name || '',
      evalbeeRollNos: s.evalbee_roll_nos || [],
      batches: s.batches || [],
    }))
}
