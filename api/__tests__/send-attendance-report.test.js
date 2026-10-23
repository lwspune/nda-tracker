// @vitest-environment node
//
// kind:'attendance-report' on api/send-attendance-alerts.js — the nightly
// in/out punch report for LWS Pune, to student + parents.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { newFlowState, facultyStateTable } from './_flowState.js'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('fs', () => ({ readFileSync: vi.fn(() => { throw new Error('no .env.local') }) }))

const ORIGINAL_ENV = { ...process.env }

// What the mocked database holds for one test. `claimed` is the set of
// lws_ids already in attendance_report_sends for the date.
let db
let flowState
beforeEach(() => {
  vi.clearAllMocks()
  flowState = newFlowState()
  db = {
    students: [],
    studentsError: null,
    claimed: new Set(),
    claimError: null,
    upserts: [],
    released: [],
  }
})
afterEach(() => { process.env = { ...ORIGINAL_ENV } })

function makeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    status(c) { this.statusCode = c; return this },
    json(p) { this.body = p; return this },
    setHeader(k, v) { this.headers[k] = v },
  }
}

function setEnv() {
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
  process.env.WABRIDGE_APP_KEY = 'app'
  process.env.WABRIDGE_AUTH_KEY = 'auth'
  process.env.WABRIDGE_DEVICE_ID = 'device'
  process.env.WABRIDGE_ATTENDANCE_REPORT_TEMPLATE_ID = 'report-template'
}

function studentsTable() {
  return {
    select: vi.fn(() => ({
      in: vi.fn((_col, ids) => Promise.resolve(db.studentsError
        ? { data: null, error: db.studentsError }
        : { data: db.students.filter(s => ids.includes(s.lws_id)), error: null })),
    })),
  }
}

function sendsTable() {
  return {
    upsert: vi.fn((rows, opts) => {
      db.upserts.push({ rows, opts })
      return {
        select: vi.fn(() => {
          if (db.claimError) return Promise.resolve({ data: null, error: db.claimError })
          const fresh = rows.filter(r => !db.claimed.has(r.lws_id))
          fresh.forEach(r => db.claimed.add(r.lws_id))
          return Promise.resolve({ data: fresh.map(r => ({ lws_id: r.lws_id })), error: null })
        }),
      }
    }),
    delete: vi.fn(() => ({
      eq: vi.fn((_c, date) => ({
        in: vi.fn((_c2, ids) => {
          db.released.push({ date, ids })
          ids.forEach(id => db.claimed.delete(id))
          return Promise.resolve({ error: null })
        }),
      })),
    })),
  }
}

function setAuth({ role } = {}) {
  createClient.mockImplementation(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'uid', app_metadata: role ? { role } : {} } },
      }),
    },
    from: vi.fn(t => {
      if (t === 'faculty_state') return facultyStateTable(flowState)
      if (t === 'students') return studentsTable()
      if (t === 'attendance_report_sends') return sendsTable()
      throw new Error(`unexpected table ${t}`)
    }),
  }))
}

function mockWabridge(okFor = () => true) {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const dest = JSON.parse(init.body).destination_number
    const ok = okFor(dest)
    return { json: async () => (ok ? { status: 1, data: { messageid: 'm' } } : { status: 0, message: 'send failed' }) }
  }))
}

const sentPayloads = () => fetch.mock.calls.map(([, init]) => JSON.parse(init.body))

async function call(body, { jwt = 'valid-jwt', method = 'POST' } = {}) {
  const { default: handler } = await import('../send-attendance-alerts.js')
  const res = makeRes()
  await handler({ method, headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body: { kind: 'attendance-report', ...body } }, res)
  return res
}

const PUNE = 'LWS Pune'
const asha = { lws_id: 'LWS-1', canonical_name: 'Asha Patil', branch: PUNE, account_status: 'Active', mobile: '9876543210', parent_mobiles: ['9876543211'] }
const ravi = { lws_id: 'LWS-2', canonical_name: 'Ravi Kumar', branch: PUNE, account_status: 'Active', mobile: '9876543220', parent_mobiles: [] }
const present = (lwsId = 'LWS-1', over = {}) => ({ lwsId, status: 'P', inTime: '08:35 AM', outTime: '06:10 PM', ...over })

describe('attendance report — doors', () => {
  it('405 for a non-POST', async () => {
    const res = await call({}, { method: 'GET' })
    // GET routes to the hostel cron by default; an explicit kind must not.
    expect(res.statusCode).toBe(405)
  })

  it('500 naming the env var when the template is not configured', async () => {
    setAuth()
    const res = await call({ date: '2026-10-23', students: [present()] })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/WABRIDGE_ATTENDANCE_REPORT_TEMPLATE_ID/)
  })

  it('401 with no session', async () => {
    setEnv()
    const res = await call({ date: '2026-10-23', students: [present()] }, { jwt: '' })
    expect(res.statusCode).toBe(401)
  })

  it('403 for a teacher session', async () => {
    setEnv(); setAuth({ role: 'teacher' }); mockWabridge()
    const res = await call({ date: '2026-10-23', students: [present()] })
    expect(res.statusCode).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('attendance report — input', () => {
  beforeEach(() => { setEnv(); setAuth(); mockWabridge(); db.students = [asha, ravi] })

  it.each([
    ['no date', { students: [present()] }],
    ['a date that is not a calendar date', { date: '2026-02-30', students: [present()] }],
    ['a non-ISO date', { date: '23/10/2026', students: [present()] }],
    ['no students', { date: '2026-10-23', students: [] }],
    ['a student with no id', { date: '2026-10-23', students: [{ status: 'P' }] }],
  ])('400 for %s', async (_label, body) => {
    const res = await call(body)
    expect(res.statusCode).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  // The browser sends in small groups so no request outlives the function.
  it('400 when one request carries more than the group size', async () => {
    const students = Array.from({ length: 26 }, (_, i) => present(`LWS-${i}`))
    const res = await call({ date: '2026-10-23', students })
    expect(res.statusCode).toBe(400)
  })
})

describe('attendance report — sending', () => {
  beforeEach(() => { setEnv(); setAuth(); db.students = [asha, ravi] })

  it('sends name, date, in time, out time — in the template order — to student and parents', async () => {
    mockWabridge()
    const res = await call({ date: '2026-10-23', students: [present()] })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, sent: 2, skipped: 0 })
    const payloads = sentPayloads()
    expect(payloads.map(p => p.destination_number)).toEqual(['919876543210', '919876543211'])
    for (const p of payloads) {
      expect(p.template_id).toBe('report-template')
      expect(p.variables).toEqual(['Asha Patil', '23 October 2026', '08:35 AM', '06:10 PM'])
    }
  })

  it('tells the family Absent for both times when the student was absent', async () => {
    mockWabridge()
    await call({ date: '2026-10-23', students: [present('LWS-2', { status: 'A', inTime: '', outTime: '' })] })
    expect(sentPayloads()[0].variables).toEqual(['Ravi Kumar', '23 October 2026', 'Absent', 'Absent'])
  })

  it('says Not punched out for a present student with no out time', async () => {
    mockWabridge()
    await call({ date: '2026-10-23', students: [present('LWS-2', { outTime: '' })] })
    expect(sentPayloads()[0].variables[3]).toBe('Not punched out')
  })

  // The browser sends ids and punch times only. Names and numbers come from the
  // students table, so a tampered request cannot point a message elsewhere.
  it('ignores any name or number the request carries', async () => {
    mockWabridge()
    await call({ date: '2026-10-23', students: [{ ...present(), name: 'Someone Else', mobile: '9000000000', parentMobiles: ['9000000001'] }] })
    const payloads = sentPayloads()
    expect(payloads.map(p => p.destination_number)).toEqual(['919876543210', '919876543211'])
    expect(payloads[0].variables[0]).toBe('Asha Patil')
  })

  it('does not message a student outside LWS Pune', async () => {
    mockWabridge()
    db.students = [{ ...asha, branch: 'APJ' }]
    const res = await call({ date: '2026-10-23', students: [present()] })
    expect(res.body.notInBranch).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not message an id the students table does not hold', async () => {
    mockWabridge()
    const res = await call({ date: '2026-10-23', students: [present('LWS-GHOST')] })
    expect(res.body.notInBranch).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not message a blocked student', async () => {
    mockWabridge()
    db.students = [{ ...asha, account_status: 'Quit' }]
    const res = await call({ date: '2026-10-23', students: [present()] })
    expect(res.body.blocked).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses the whole send when the students read fails', async () => {
    mockWabridge()
    db.studentsError = { message: 'permission denied' }
    const res = await call({ date: '2026-10-23', students: [present()] })
    expect(res.statusCode).toBe(500)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('writes log lines the failed-resend parser can read', async () => {
    mockWabridge(dest => dest !== '919876543211')
    const res = await call({ date: '2026-10-23', students: [present()] })
    const text = res.body.lines.join('\n')
    expect(text).toContain('SENT → Asha Patil (student → 919876543210)')
    expect(text).toContain('FAIL → Asha Patil (parent → 919876543211): send failed')
  })
})

describe('attendance report — never twice', () => {
  beforeEach(() => { setEnv(); setAuth(); db.students = [asha, ravi] })

  it('records each student for the date before messaging them', async () => {
    mockWabridge()
    await call({ date: '2026-10-23', students: [present('LWS-1'), present('LWS-2')] })
    expect(db.upserts).toHaveLength(1)
    expect(db.upserts[0].rows).toEqual([
      { date: '2026-10-23', lws_id: 'LWS-1' },
      { date: '2026-10-23', lws_id: 'LWS-2' },
    ])
    expect(db.upserts[0].opts).toEqual({ onConflict: 'date,lws_id', ignoreDuplicates: true })
  })

  it('skips a student already sent for that date', async () => {
    mockWabridge()
    db.claimed.add('LWS-1')
    const res = await call({ date: '2026-10-23', students: [present('LWS-1'), present('LWS-2')] })
    expect(res.body.alreadySent).toBe(1)
    expect(sentPayloads().every(p => p.variables[0] === 'Ravi Kumar')).toBe(true)
    expect(res.body.lines.join('\n')).toContain('SKIP Asha Patil — already sent for this date')
  })

  it('sends nothing on a second identical request', async () => {
    mockWabridge()
    await call({ date: '2026-10-23', students: [present()] })
    fetch.mockClear()
    const res = await call({ date: '2026-10-23', students: [present()] })
    expect(res.body.alreadySent).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses the whole send when the record cannot be written', async () => {
    mockWabridge()
    db.claimError = { message: 'relation does not exist' }
    const res = await call({ date: '2026-10-23', students: [present()] })
    expect(res.statusCode).toBe(500)
    expect(fetch).not.toHaveBeenCalled()
  })

  // A family nobody reached must be retried by the next run, not counted done.
  it('releases the record when no message reached the family', async () => {
    mockWabridge(() => false)
    const res = await call({ date: '2026-10-23', students: [present()] })
    expect(res.body.sent).toBe(0)
    expect(db.released).toEqual([{ date: '2026-10-23', ids: ['LWS-1'] }])
    expect(db.claimed.has('LWS-1')).toBe(false)
  })

  it('keeps the record when at least one message reached the family', async () => {
    mockWabridge(dest => dest === '919876543210')
    await call({ date: '2026-10-23', students: [present()] })
    expect(db.released).toEqual([])
    expect(db.claimed.has('LWS-1')).toBe(true)
  })

  it('releases the record for a student with no usable number', async () => {
    mockWabridge()
    db.students = [{ ...asha, mobile: '', parent_mobiles: [] }]
    await call({ date: '2026-10-23', students: [present()] })
    expect(db.released).toEqual([{ date: '2026-10-23', ids: ['LWS-1'] }])
  })

  // A test send goes to the office's own number. It must neither be blocked by
  // an earlier real send nor mark the family as done.
  it('a redirected test send neither records nor checks the record', async () => {
    mockWabridge()
    db.claimed.add('LWS-1')
    const res = await call({ date: '2026-10-23', redirectTo: '9000000001', students: [present()] })
    expect(db.upserts).toEqual([])
    expect(res.body.sent).toBe(2)
    expect(sentPayloads().every(p => p.destination_number === '919000000001')).toBe(true)
  })
})

describe('attendance report — flow switch', () => {
  beforeEach(() => { setEnv(); setAuth(); mockWabridge(); db.students = [asha] })

  it('409 and nothing sent or recorded when switched off', async () => {
    flowState.flows = { attendanceReport: { enabled: false } }
    const res = await call({ date: '2026-10-23', students: [present()] })
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ disabled: true, flow: 'attendanceReport' })
    expect(fetch).not.toHaveBeenCalled()
    expect(db.upserts).toEqual([])
  })

  it('lets a redirected test send through while switched off', async () => {
    flowState.flows = { attendanceReport: { enabled: false } }
    const res = await call({ date: '2026-10-23', redirectTo: '9000000001', students: [present()] })
    expect(res.statusCode).toBe(200)
  })

  it('treats an unparseable redirect as a real send', async () => {
    flowState.flows = { attendanceReport: { enabled: false } }
    const res = await call({ date: '2026-10-23', redirectTo: '12', students: [present()] })
    expect(res.statusCode).toBe(409)
  })
})
