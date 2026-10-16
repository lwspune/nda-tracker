// Who gets the marked-paper report by email, and what it says (2026-10-16).
// PURE. Used by the local sender (scripts/grading/_sendReports.js, run from
// the admin app's dev server) and by the staff page's counts, so relative
// imports carry their .js extension.
//
// Sent only from the local admin app, by an admin. Never a held or unmarked
// paper, never to a blocked account (the WhatsApp rule: blank status = active),
// never to a missing or malformed address. A test send goes to staff, so the
// student's address and status do not matter to it, but the paper must still
// be one a student may see.
import { isBlockedStatus } from '../accountStatus.js'
import { reportPdfPath } from './upload.js'
import { buildPaperReport } from './paperReport.js'

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/
export const isEmailAddress = v => typeof v === 'string' && EMAIL.test(v.trim())

// The staff row (camelCase, from mapSubmissionRow): may its report be emailed?
export function canEmailReport(sub) {
  return sub.status === 'graded' && (sub.markedPages?.length ?? 0) > 0 && !sub.scansDeletedAt
}

const num = v => (v === null || v === undefined ? null : Number(v))
const fmt = n => String(Number(n))
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const safeName = s => String(s).replace(/[\\/:*?"<>|]/g, '-').trim()

function message(r, title) {
  const grades = (r.homework_grades ?? []).map(g => ({
    position: g.position, label: g.label, maxMarks: num(g.max_marks), outcome: g.outcome,
    awarded: num(g.awarded), missing: g.missing ?? null, cause: g.cause ?? null, topic: g.topic ?? null,
  }))
  const report = buildPaperReport(grades)
  const first = String(r.student_name ?? '').trim().split(/\s+/)[0] || 'there'
  const score = `${fmt(r.total_awarded)} / ${fmt(r.total_max)}`
  const focus = report.focus.map(f => `${f.heading} (${f.label})`)

  const text = [
    `Hi ${first},`, '',
    `Your homework "${title}" has been marked: ${score} (${report.pct}%).`, '',
    ...(focus.length ? ['What to focus on first:', ...focus.map(f => `- ${f}`), ''] : []),
    'Your marked paper is attached as a PDF. Each page shows where marks were given and where they were lost, with a note on what to fix.',
    '', 'LWS Pune',
  ].join('\n')

  const html = [
    `<p>Hi ${esc(first)},</p>`,
    `<p>Your homework <b>${esc(title)}</b> has been marked: <b>${esc(score)}</b> (${report.pct}%).</p>`,
    ...(focus.length ? ['<p>What to focus on first:</p><ul>', ...focus.map(f => `<li>${esc(f)}</li>`), '</ul>'] : []),
    '<p>Your marked paper is attached as a PDF. Each page shows where marks were given and where they were lost, with a note on what to fix.</p>',
    '<p>LWS Pune</p>',
  ].join('\n')

  return { text, html, score }
}

// rows: submissions as selected, with students(email, account_status),
// homework_assignments(title) and homework_grades. testTo: a staff address to
// send every message to instead (nothing is recorded as sent).
export function planReportEmails({ rows, testTo = null }) {
  const test = testTo === null || testTo === undefined ? null : String(testTo).trim()
  if (test !== null && !isEmailAddress(test)) throw new Error('The test address is not an email address.')
  const send = []
  const skipped = []
  for (const r of rows ?? []) {
    const name = r.student_name ?? ''
    const skip = reason => skipped.push({ id: r.id, name, reason })
    if (r.status !== 'graded') { skip('not released yet'); continue }
    if (!r.marked_pages) { skip('graded before marked papers existed'); continue }
    if (r.scans_deleted_at) { skip('marked paper removed after 30 days'); continue }
    const email = String(r.students?.email ?? '').trim()
    if (!test) {
      if (isBlockedStatus(r.students?.account_status)) { skip('account is blocked'); continue }
      if (!isEmailAddress(email)) { skip('no email address on file'); continue }
    }
    const title = r.homework_assignments?.title ?? 'Homework'
    const { text, html, score } = message(r, title)
    const subject = `${r.regraded_at ? 'Updated: ' : ''}Your marked homework: ${title} (${score.replace(/ /g, '')})`
    send.push({
      id: r.id, name, to: test ?? email, markSent: !test,
      subject: test ? `[TEST] ${subject}` : subject, text, html,
      pdfPath: reportPdfPath(r.assignment_id, r.lws_id, r.id),
      filename: `Marked - ${safeName(title)}.pdf`,
    })
  }
  return { send, skipped }
}
