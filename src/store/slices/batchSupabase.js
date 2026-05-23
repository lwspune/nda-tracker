import { getExamBatches } from '../../lib/analytics'

// Cascades a central batch rename into the two normalised Supabase tables that
// the JSONB cascade can't reach: student_batches (per-student batch assignments)
// and exams.batch (single-name or comma-joined multi-batch tag).
//
// Contract:
//   - Idempotent under repeated calls (UPSERT + exact token replace).
//   - No-op when names are empty / equal / clientless / comma-containing.
//   - Returns counts for telemetry / surface-banner.
//
// Why two operations, not one transaction:
//   - student_batches PK is (lws_id, batch_name); we can't UPDATE the PK in
//     place, so it's DELETE old + UPSERT new (ignoreDuplicates handles the
//     edge case of a student already holding both).
//   - exams.batch is a free-text column carrying either a single name or a
//     comma-joined list. Substring matches at the SQL LIKE level are filtered
//     client-side via getExamBatches so we never rewrite partial names like
//     `OldName_extra`.
//
// Fire-and-forget from configSlice.renameBatch — caller doesn't await.

export async function cascadeBatchRenameToSupabase(client, oldName, newName) {
  const noop = { studentBatchRows: 0, examRows: 0 }
  if (!client) return noop
  const oldTrim = (oldName ?? '').toString().trim()
  const newTrim = (newName ?? '').toString().trim()
  if (!oldTrim || !newTrim || oldTrim === newTrim) return noop
  // A comma-containing oldName could never have been a central batch name
  // (addBatch rejects them) — refuse to operate on it.
  if (oldTrim.includes(',')) return noop

  // ── student_batches ──────────────────────────────────────────
  let studentBatchRows = 0
  const { data: affected, error: readErr } = await client
    .from('student_batches')
    .select('lws_id')
    .eq('batch_name', oldTrim)
  if (readErr) {
    console.error('[batchSupabase] student_batches read failed:', readErr)
    return noop
  }
  const lwsIds = (affected ?? []).map(r => r.lws_id)
  if (lwsIds.length > 0) {
    const { error: delErr } = await client
      .from('student_batches')
      .delete()
      .eq('batch_name', oldTrim)
    if (delErr) console.error('[batchSupabase] student_batches delete failed:', delErr)
    const rows = lwsIds.map(lws_id => ({ lws_id, batch_name: newTrim }))
    const { error: upErr } = await client
      .from('student_batches')
      .upsert(rows, { onConflict: 'lws_id,batch_name', ignoreDuplicates: true })
    if (upErr) console.error('[batchSupabase] student_batches upsert failed:', upErr)
    studentBatchRows = lwsIds.length
  }

  // ── exams.batch ──────────────────────────────────────────────
  // LIKE-filter Postgres-side, then strict-token-filter client-side.
  let examRows = 0
  const { data: candidateExams, error: examReadErr } = await client
    .from('exams')
    .select('id, batch')
    .like('batch', `%${oldTrim}%`)
  if (examReadErr) {
    console.error('[batchSupabase] exams read failed:', examReadErr)
    return { studentBatchRows, examRows }
  }
  for (const exam of (candidateExams ?? [])) {
    const tokens = getExamBatches(exam)
    if (!tokens.includes(oldTrim)) continue   // LIKE false positive (substring match)
    const newTokens = tokens.map(t => t === oldTrim ? newTrim : t)
    const newBatch  = newTokens.join(', ')
    const { error: updErr } = await client
      .from('exams')
      .update({ batch: newBatch })
      .eq('id', exam.id)
    if (updErr) console.error('[batchSupabase] exams update failed:', updErr)
    else examRows++
  }

  return { studentBatchRows, examRows }
}
