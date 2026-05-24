// When a name variant is linked to a student, any pre-link exam_absences row
// where exam_results already has that variant as an attendee is stale — the
// student actually attended, just under a spelling the system didn't yet
// recognise. This helper sweeps those rows.
//
// Contract:
//   - Idempotent (re-running with the same args after a successful run is a no-op
//     because the absence rows are already gone).
//   - No-op on empty / clientless inputs.
//   - Fire-and-forget from studentSlice.addNameVariant — caller doesn't await
//     for the result, but does await the promise so refreshStudents runs after.

export async function cleanStaleAbsencesForVariant(client, lwsId, variantName) {
  const noop = { deleted: 0 }
  if (!client) return noop
  if (!lwsId || !variantName) return noop

  const { data: results, error: readErr } = await client
    .from('exam_results')
    .select('exam_id')
    .eq('student_name', variantName)
  if (readErr) {
    console.error('[absenceCleanup] exam_results read failed:', readErr)
    return noop
  }
  const examIds = [...new Set((results ?? []).map(r => r.exam_id).filter(Boolean))]
  if (examIds.length === 0) return noop

  const { error: delErr } = await client
    .from('exam_absences')
    .delete()
    .eq('lws_id', lwsId)
    .in('exam_id', examIds)
  if (delErr) {
    console.error('[absenceCleanup] exam_absences delete failed:', delErr)
    return noop
  }

  return { deleted: examIds.length }
}
