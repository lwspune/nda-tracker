// @vitest-environment node
// The local sender behind the admin app's "Email report" button (2026-10-16).
import { describe, it, expect, vi } from 'vitest'
import { sendHomeworkReports } from '../_sendReports.js'

const row = (over = {}) => ({
  id: 's1', assignment_id: 'a1', lws_id: 'L1', student_name: 'Arjun Sharma', status: 'graded',
  marked_pages: 2, scans_deleted_at: null, regraded_at: null, total_awarded: 15, total_max: 20,
  students: { email: 'arjun@example.com', account_status: 'Active' },
  homework_assignments: { title: 'Limits', subject: 'Maths' }, homework_grades: [],
  ...over,
})

function makeDb({ rows = [row()], readError = null, missingPdf = [], updateError = null } = {}) {
  const log = []
  const db = {
    log,
    from: vi.fn(() => {
      const b = {
        select: vi.fn(() => b),
        in: vi.fn((col, ids) => { log.push(['in', col, ids]); return b }),
        update: vi.fn(values => { log.push(['update', values]); return b }),
        eq: vi.fn((col, v) => { log.push(['eq', col, v]); return b }),
        then: (ok, bad) => {
          const isUpdate = log.some(l => l[0] === 'update') && log[log.length - 1][0] === 'eq'
          return Promise.resolve(isUpdate ? { error: updateError } : { data: rows, error: readError }).then(ok, bad)
        },
      }
      return b
    }),
    storage: {
      from: vi.fn(bucket => ({
        download: vi.fn(async path => {
          log.push(['download', bucket, path])
          if (missingPdf.includes(path)) return { data: null, error: { message: 'Object not found' } }
          return { data: new Blob([Buffer.from('%PDF-1.7 x')]), error: null }
        }),
      })),
    },
  }
  return db
}

const stamps = db => db.log.filter(l => l[0] === 'update')

describe('sendHomeworkReports', () => {
  it('sends each report with its PDF, then records it as sent', async () => {
    const db = makeDb()
    const mail = vi.fn(async () => {})
    const r = await sendHomeworkReports({ db, mail, ids: ['s1'] })
    expect(r).toMatchObject({ ok: true, status: 200, test: false, failed: [], skipped: [] })
    expect(r.sent).toEqual([{ id: 's1', name: 'Arjun Sharma', to: 'arjun@example.com' }])
    expect(db.log).toContainEqual(['download', 'homework-submissions', 'a1/L1/s1/marked/report.pdf'])
    const [msg] = mail.mock.calls[0]
    expect(msg).toMatchObject({ to: 'arjun@example.com', filename: 'Marked - Limits.pdf' })
    expect(msg.pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(stamps(db)).toHaveLength(1)
    expect(stamps(db)[0][1]).toHaveProperty('report_emailed_at')
    // Only while still released: a regrade racing the send must not be stamped.
    expect(db.log).toContainEqual(['eq', 'status', 'graded'])
  })

  it('never mails what the plan skips, and says why', async () => {
    const db = makeDb({ rows: [row({ status: 'held' })] })
    const mail = vi.fn()
    const r = await sendHomeworkReports({ db, mail, ids: ['s1'] })
    expect(mail).not.toHaveBeenCalled()
    expect(r.skipped).toEqual([{ id: 's1', name: 'Arjun Sharma', reason: 'not released yet' }])
    expect(stamps(db)).toEqual([])
  })

  it('reports an id it could not find', async () => {
    const r = await sendHomeworkReports({ db: makeDb({ rows: [] }), mail: vi.fn(), ids: ['gone'] })
    expect(r.skipped).toEqual([{ id: 'gone', name: '', reason: 'not found' }])
  })

  it('records nothing for a test send', async () => {
    const db = makeDb()
    const mail = vi.fn(async () => {})
    const r = await sendHomeworkReports({ db, mail, ids: ['s1'], testTo: 'admin@lws.example' })
    expect(r.test).toBe(true)
    expect(mail.mock.calls[0][0].to).toBe('admin@lws.example')
    expect(stamps(db)).toEqual([])
  })

  it('keeps going past a failure, and records only what Gmail accepted', async () => {
    const db = makeDb({ rows: [row(), row({ id: 's2', student_name: 'Bhavya Rao' })] })
    const mail = vi.fn(async m => { if (m.subject && mail.mock.calls.length === 1) throw new Error('SMTPAuthenticationError: bad password') })
    const r = await sendHomeworkReports({ db, mail, ids: ['s1', 's2'] })
    expect(r.failed).toEqual([{ id: 's1', name: 'Arjun Sharma', error: 'SMTPAuthenticationError: bad password' }])
    expect(r.sent.map(s => s.id)).toEqual(['s2'])
    expect(stamps(db)).toHaveLength(1)
  })

  it('fails one whose PDF is missing, without mailing it', async () => {
    const db = makeDb({ missingPdf: ['a1/L1/s1/marked/report.pdf'] })
    const mail = vi.fn()
    const r = await sendHomeworkReports({ db, mail, ids: ['s1'] })
    expect(mail).not.toHaveBeenCalled()
    expect(r.failed[0]).toMatchObject({ id: 's1', error: expect.stringMatching(/report PDF/i) })
  })

  it('says when a sent email could not be recorded', async () => {
    const r = await sendHomeworkReports({ db: makeDb({ updateError: { message: 'x' } }), mail: vi.fn(async () => {}), ids: ['s1'] })
    expect(r.sent).toEqual([])
    expect(r.failed[0].error).toMatch(/sent, but not recorded/i)
  })

  it('refuses an empty or oversized request, and a bad test address, before reading', async () => {
    const db = makeDb()
    expect(await sendHomeworkReports({ db, mail: vi.fn(), ids: [] })).toMatchObject({ ok: false, status: 400 })
    expect(await sendHomeworkReports({ db, mail: vi.fn(), ids: Array(201).fill('x') })).toMatchObject({ ok: false, status: 400 })
    expect(await sendHomeworkReports({ db, mail: vi.fn(), ids: ['s1'], testTo: 'nope' })).toMatchObject({ ok: false, status: 400 })
    expect(db.from).not.toHaveBeenCalled()
  })

  it('fails closed when the submissions cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const mail = vi.fn()
    const r = await sendHomeworkReports({ db: makeDb({ readError: { message: 'down' } }), mail, ids: ['s1'] })
    expect(r).toMatchObject({ ok: false, status: 500 })
    expect(mail).not.toHaveBeenCalled()
  })
})
