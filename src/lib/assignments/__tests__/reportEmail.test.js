import { describe, it, expect } from 'vitest'
import { planReportEmails, canEmailReport, isEmailAddress } from '../reportEmail'

// A submission row as the sender selects it (snake_case, with joins).
const row = (over = {}) => ({
  id: 's1', assignment_id: 'a1', lws_id: 'L1', student_name: 'Arjun Sharma', status: 'graded',
  marked_pages: 2, scans_deleted_at: null, regraded_at: null, total_awarded: '15', total_max: '20',
  students: { email: 'arjun@example.com', account_status: 'Active' },
  homework_assignments: { title: 'Maths Daily Homework #3', subject: 'Maths' },
  homework_grades: [
    { position: 1, label: 'Q1', max_marks: '10', outcome: 'scored', awarded: '7', missing: 'No final value.', cause: 'incomplete', topic: 'State the final value' },
    { position: 2, label: 'Q2', max_marks: '10', outcome: 'scored', awarded: '8', missing: 'Wrong rule.', cause: 'concept', topic: 'Product rule' },
  ],
  ...over,
})

describe('planReportEmails — who gets one', () => {
  it('sends a released grade with a marked paper to the student, and records it', () => {
    const { send, skipped } = planReportEmails({ rows: [row()] })
    expect(skipped).toEqual([])
    expect(send).toHaveLength(1)
    expect(send[0]).toMatchObject({
      id: 's1', name: 'Arjun Sharma', to: 'arjun@example.com', markSent: true,
      pdfPath: 'a1/L1/s1/marked/report.pdf', filename: 'Marked - Maths Daily Homework #3.pdf',
    })
  })

  // A held grade must never reach a student by email any more than by portal.
  it('skips, with a reason staff can act on, anything that should not be sent', () => {
    const { send, skipped } = planReportEmails({
      rows: [
        row({ id: 'h', status: 'held' }),
        row({ id: 'w', status: 'submitted' }),
        row({ id: 'o', marked_pages: null }),
        row({ id: 'p', scans_deleted_at: '2026-11-20T00:00:00Z' }),
        row({ id: 'b', students: { email: 'b@example.com', account_status: 'Quit' } }),
        row({ id: 'e', students: { email: '', account_status: 'Active' } }),
        row({ id: 'x', students: { email: 'not-an-address', account_status: 'Active' } }),
      ],
    })
    expect(send).toEqual([])
    expect(skipped.map(s => [s.id, s.reason])).toEqual([
      ['h', 'not released yet'],
      ['w', 'not released yet'],
      ['o', 'graded before marked papers existed'],
      ['p', 'marked paper removed after 30 days'],
      ['b', 'account is blocked'],
      ['e', 'no email address on file'],
      ['x', 'no email address on file'],
    ])
  })

  // Blank status is a legacy row: allowed, as at login and on WhatsApp.
  it('sends to a blank account status', () => {
    expect(planReportEmails({ rows: [row({ students: { email: 'a@b.co', account_status: null } })] }).send).toHaveLength(1)
  })

  it('refuses a missing student join as no address, never sends to undefined', () => {
    const { send, skipped } = planReportEmails({ rows: [row({ students: null })] })
    expect(send).toEqual([])
    expect(skipped[0].reason).toBe('no email address on file')
  })
})

describe('planReportEmails — a test send', () => {
  it('goes to the test address only, marked [TEST], and records nothing', () => {
    const { send } = planReportEmails({ rows: [row()], testTo: ' admin@lws.example ' })
    expect(send[0]).toMatchObject({ to: 'admin@lws.example', markSent: false })
    expect(send[0].subject).toMatch(/^\[TEST\] /)
  })

  // A test goes to staff, not the student, so the student's own address and
  // status do not matter — but it is still never a held or unmarked paper.
  it('previews a blocked or address-less student, but never an unreleased paper', () => {
    const { send, skipped } = planReportEmails({
      rows: [row({ students: { email: '', account_status: 'Quit' } }), row({ id: 'h', status: 'held' })],
      testTo: 'admin@lws.example',
    })
    expect(send.map(s => s.id)).toEqual(['s1'])
    expect(skipped.map(s => s.id)).toEqual(['h'])
  })

  it('refuses a test address that is not an address', () => {
    expect(() => planReportEmails({ rows: [row()], testTo: 'admin' })).toThrow(/test address/i)
  })
})

describe('planReportEmails — the message', () => {
  const [msg] = planReportEmails({ rows: [row()] }).send

  it('names the homework and the score in the subject', () => {
    expect(msg.subject).toBe('Your marked homework: Maths Daily Homework #3 (15/20)')
  })

  it('says "Updated" after a regrade', () => {
    const [m] = planReportEmails({ rows: [row({ regraded_at: '2026-10-17T00:00:00Z' })] }).send
    expect(m.subject).toMatch(/^Updated: /)
  })

  it('greets by first name, gives the score and what to focus on, and says the paper is attached', () => {
    for (const body of [msg.html, msg.text]) {
      expect(body).toMatch(/Arjun/)
      expect(body).toMatch(/15 \/ 20/)
      expect(body).toMatch(/75%/)
      expect(body).toMatch(/Learn this again: Product rule/)
      expect(body).toMatch(/Show full steps: State the final value/)
      expect(body).toMatch(/attached/i)
    }
    expect(msg.text).not.toMatch(/</)
  })

  it('escapes what came from the grade before putting it in HTML', () => {
    const [m] = planReportEmails({
      rows: [row({ homework_grades: [{ position: 1, label: 'Q1', max_marks: '20', outcome: 'scored', awarded: '15', missing: 'x', cause: 'concept', topic: '<b>a & b</b>' }] })],
    }).send
    expect(m.html).toContain('&lt;b&gt;a &amp; b&lt;/b&gt;')
    expect(m.html).not.toContain('<b>a & b</b>')
  })

  it('keeps the attachment name safe for a file', () => {
    const [m] = planReportEmails({ rows: [row({ homework_assignments: { title: 'Ex 2/3: Limits?', subject: 'Maths' } })] }).send
    expect(m.filename).toBe('Marked - Ex 2-3- Limits-.pdf')
  })
})

describe('canEmailReport (the staff row)', () => {
  it('is true only for a released grade whose marked paper is still kept', () => {
    const sub = { status: 'graded', markedPages: ['x'], scansDeletedAt: null }
    expect(canEmailReport(sub)).toBe(true)
    expect(canEmailReport({ ...sub, status: 'held' })).toBe(false)
    expect(canEmailReport({ ...sub, markedPages: [] })).toBe(false)
    expect(canEmailReport({ ...sub, scansDeletedAt: 't' })).toBe(false)
  })
})

describe('isEmailAddress', () => {
  it('accepts an ordinary address and refuses the rest', () => {
    expect(isEmailAddress('a.b+c@d-e.co.in')).toBe(true)
    for (const bad of ['', ' ', 'a@b', 'a b@c.d', '@c.d', 'a@.d', null, undefined]) expect(isEmailAddress(bad), String(bad)).toBe(false)
  })
})
