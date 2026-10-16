// Email marked-paper reports (2026-10-16). Run by the local admin app's dev
// server (vite.config.js, POST /api/send-homework-report), the same way the
// teacher schedule emails are sent: only on the office machine, only by an
// admin. Service role, because submissions have no write policy.
//
// Who gets what is decided in src/lib/assignments/reportEmail.js. This reads
// the rows, fetches each stored PDF, hands the message to `mail`, and records
// the send ONLY after the mailer accepted it. One failure never stops the rest.
import { planReportEmails } from '../../src/lib/assignments/reportEmail.js'
import { SUBMISSIONS_BUCKET } from '../../src/lib/assignments/upload.js'

export const MAX_PER_SEND = 200

const COLUMNS = [
  'id, assignment_id, lws_id, student_name, status, marked_pages, scans_deleted_at, regraded_at, total_awarded, total_max',
  'students(email, account_status)',
  'homework_assignments(title, subject)',
  'homework_grades(position, label, max_marks, outcome, awarded, missing, cause, topic)',
].join(', ')

// { db, mail, ids, testTo? } → { ok, status, sent, skipped, failed, test } | { ok: false, status, error }
// mail({ to, subject, text, html, filename, pdf: Buffer }) resolves when sent, throws with the reason.
export async function sendHomeworkReports({ db, mail, ids, testTo = null }) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PER_SEND) {
    return { ok: false, status: 400, error: `Pick between 1 and ${MAX_PER_SEND} submissions.` }
  }
  const test = testTo ? String(testTo).trim() : null
  // Check the test address before touching the database.
  try { planReportEmails({ rows: [], testTo: test }) } catch (e) { return { ok: false, status: 400, error: e.message } }

  const { data: rows, error } = await db.from('homework_submissions').select(COLUMNS).in('id', ids)
  if (error || !rows) {
    console.error('[send-homework-report] read failed:', error?.message)
    return { ok: false, status: 500, error: 'Could not read the submissions. Nothing was sent.' }
  }

  const plan = planReportEmails({ rows, testTo: test })
  const found = new Set(rows.map(r => r.id))
  const skipped = [...ids.filter(id => !found.has(id)).map(id => ({ id, name: '', reason: 'not found' })), ...plan.skipped]
  const sent = []
  const failed = []

  for (const m of plan.send) {
    const who = { id: m.id, name: m.name }
    const { data: blob, error: dErr } = await db.storage.from(SUBMISSIONS_BUCKET).download(m.pdfPath)
    if (dErr || !blob) { failed.push({ ...who, error: 'The report PDF is missing. Run grading:preview and grading:commit again.' }); continue }
    try {
      await mail({ to: m.to, subject: m.subject, text: m.text, html: m.html, filename: m.filename, pdf: Buffer.from(await blob.arrayBuffer()) })
    } catch (e) {
      failed.push({ ...who, error: e instanceof Error ? e.message : String(e) })
      continue
    }
    if (m.markSent) {
      // Only while still released: a regrade racing the send must stay "not sent".
      const { error: uErr } = await db.from('homework_submissions')
        .update({ report_emailed_at: new Date().toISOString() })
        .eq('id', m.id)
        .eq('status', 'graded')
      if (uErr) { failed.push({ ...who, error: `Sent, but not recorded as sent: ${uErr.message}` }); continue }
    }
    sent.push({ ...who, to: m.to })
  }

  return { ok: true, status: 200, sent, skipped, failed, test: Boolean(test) }
}
