import { describe, it, expect } from 'vitest'
import {
  buildGradingQueue, planTidy, homeworkFingerprint, schemeTemplate, schemeStatus, checkScheme,
} from '../gradingQueue'

const entry = (over = {}) => ({
  submissionId: 's1', homeworkId: 'h1', title: 'Daily Homework #4', studentKey: 'k1',
  dueAt: '2026-10-20T12:30:00.000Z', submittedAt: '2026-10-19T10:00:00.000Z',
  pages: 3, hasReference: true, fingerprint: 'f1', maxMarks: 20,
  breakdown: [{ label: 'Q1', marks: 10 }, { label: 'Q2', marks: 10 }],
  ...over,
})

describe('buildGradingQueue', () => {
  it('groups submissions by homework, earliest deadline first, oldest hand-in first', () => {
    const q = buildGradingQueue([
      entry({ submissionId: 'late', homeworkId: 'h2', title: 'HW #5', dueAt: '2026-10-22T12:30:00.000Z', studentKey: 'k9' }),
      entry({ submissionId: 'b', submittedAt: '2026-10-19T11:00:00.000Z', studentKey: 'k2' }),
      entry({ submissionId: 'a', submittedAt: '2026-10-19T09:00:00.000Z', studentKey: 'k3' }),
    ])
    expect(q.homeworks.map(h => h.homeworkId)).toEqual(['h1', 'h2'])
    expect(q.homeworks[0].submissions).toEqual(['a', 'b'])
    expect(q.homeworks[0]).toMatchObject({ title: 'Daily Homework #4', maxMarks: 20, fingerprint: 'f1', fingerprintConflict: false })
    expect(q.homeworks[0].breakdown).toEqual([{ label: 'Q1', marks: 10 }, { label: 'Q2', marks: 10 }])
  })

  // A student's first graded homework becomes their handwriting reference the
  // moment it is saved, so two of one student's hand-ins graded side by side
  // would both record no_reference. The later one waits for the earlier.
  it('chains one student\'s submissions in deadline order', () => {
    const q = buildGradingQueue([
      entry({ submissionId: 'second', homeworkId: 'h2', dueAt: '2026-10-22T12:30:00.000Z', studentKey: 'k1', hasReference: false }),
      entry({ submissionId: 'first', homeworkId: 'h1', studentKey: 'k1', hasReference: false }),
      entry({ submissionId: 'other', homeworkId: 'h2', dueAt: '2026-10-22T12:30:00.000Z', studentKey: 'k2' }),
    ])
    const by = Object.fromEntries(q.submissions.map(s => [s.submissionId, s]))
    expect(by.first.after).toBeNull()
    expect(by.second.after).toBe('first')
    expect(by.other.after).toBeNull()
    // pulled with no reference, after a submission that will become one: re-pull before grading
    expect(by.second.repullFirst).toBe(true)
    expect(by.first.repullFirst).toBe(false)
  })

  it('does not ask for a re-pull when the student already had a reference', () => {
    const q = buildGradingQueue([
      entry({ submissionId: 'first', studentKey: 'k1', hasReference: true }),
      entry({ submissionId: 'second', homeworkId: 'h2', dueAt: '2026-10-22T12:30:00.000Z', studentKey: 'k1', hasReference: true }),
    ])
    expect(q.submissions.find(s => s.submissionId === 'second')).toMatchObject({ after: 'first', repullFirst: false })
  })

  // Two folders of one homework holding different papers is the 2026-10-22
  // mix-up (the #5 paper attached to #4, replaced between pulls).
  it('flags a homework whose pulled folders disagree on the paper', () => {
    const q = buildGradingQueue([
      entry({ submissionId: 'a', studentKey: 'k1', fingerprint: 'old' }),
      entry({ submissionId: 'b', studentKey: 'k2', fingerprint: 'new' }),
    ])
    expect(q.homeworks[0].fingerprintConflict).toBe(true)
    expect(q.homeworks[0].fingerprint).toBeNull()
  })

  it('carries no student identity, only the opaque key', () => {
    const q = buildGradingQueue([entry({ studentName: 'Arjun Sharma', lwsId: 'LWS-1' })])
    expect(JSON.stringify(q)).not.toMatch(/Arjun|LWS-1/)
  })

  it('is empty for an empty inbox', () => {
    expect(buildGradingQueue([])).toEqual({ homeworks: [], submissions: [] })
  })
})

describe('planTidy', () => {
  const statusById = { w: 'submitted', u: 'uploading', g: 'graded', h: 'held', r: 'rejected', x: 'replaced' }

  it('removes folders whose submission is saved, rejected or replaced, and keeps waiting ones', () => {
    const plan = planTidy({ folders: ['w', 'u', 'g', 'h', 'r', 'x'], statusById, handFolders: [], waitingHomeworks: [] })
    expect(plan.remove.sort()).toEqual(['g', 'h', 'r', 'x'])
    expect(plan.keep.sort()).toEqual(['u', 'w'])
    expect(plan.unknown).toEqual([])
  })

  // Never delete what cannot be accounted for: a folder the database does not
  // know is reported, not removed.
  it('keeps and reports a folder with no submission in the database', () => {
    const plan = planTidy({ folders: ['ghost'], statusById, handFolders: [], waitingHomeworks: [] })
    expect(plan.remove).toEqual([])
    expect(plan.unknown).toEqual(['ghost'])
  })

  it('never touches the coordinator\'s own folders', () => {
    const plan = planTidy({ folders: ['_hand', '_scheme', '_queue.json'], statusById, handFolders: [], waitingHomeworks: [] })
    expect(plan).toMatchObject({ remove: [], keep: [], unknown: [] })
  })

  it('removes a hand-compare pack once its homework has nothing waiting', () => {
    const plan = planTidy({ folders: [], statusById, handFolders: ['h1', 'h2'], waitingHomeworks: ['h2'] })
    expect(plan.removeHand).toEqual(['h1'])
  })
})

describe('homeworkFingerprint', () => {
  const base = {
    assignment: { max_marks: '20', instructions: 'Show working.', questions: [{ label: 'Q1', marks: 10 }, { label: 'Q2', marks: 10 }] },
    paperHashes: ['p1'], keyHashes: ['k1'],
  }

  it('is stable for the same homework', () => {
    expect(homeworkFingerprint(base)).toBe(homeworkFingerprint(structuredClone(base)))
    expect(homeworkFingerprint(base)).toMatch(/^[0-9a-f]{8,}$/)
  })

  it.each([
    ['the paper', { paperHashes: ['p2'] }],
    ['the key', { keyHashes: ['k2'] }],
    ['the total', { assignment: { ...base.assignment, max_marks: '25' } }],
    ['a question\'s marks', { assignment: { ...base.assignment, questions: [{ label: 'Q1', marks: 5 }, { label: 'Q2', marks: 15 }] } }],
    ['the description', { assignment: { ...base.assignment, instructions: 'Ex 3.2 Q1-5' } }],
  ])('changes when %s changes', (_what, over) => {
    expect(homeworkFingerprint({ ...base, ...over })).not.toBe(homeworkFingerprint(base))
  })
})

describe('marking scheme', () => {
  const homework = {
    homeworkId: 'h1', title: 'Daily Homework #4', fingerprint: 'abc123', maxMarks: 10,
    breakdown: [{ label: 'Q1', marks: 5 }, { label: 'Q2', marks: 5 }],
  }

  it('stamps the template with the fingerprint and one section per question', () => {
    const t = schemeTemplate(homework)
    expect(t).toMatch(/Fingerprint: abc123/)
    expect(t).toMatch(/## Q1 — 5 marks/)
    expect(t).toMatch(/## Q2 — 5 marks/)
  })

  // Graders work from the scheme, not the paper: each question must be
  // recognisable on a page, givens included (a wrong value copied is a misread).
  it('asks for each question and its given values', () => {
    expect(schemeTemplate(homework)).toMatch(/Question: TODO .*given value/)
  })

  it('reads missing, stale and current', () => {
    expect(schemeStatus(null, 'abc123')).toBe('missing')
    expect(schemeStatus(schemeTemplate(homework), 'zzz')).toBe('stale')
    expect(schemeStatus(schemeTemplate(homework), 'abc123')).toBe('current')
  })

  // The template's blanks are what an unwritten scheme looks like; graders
  // must never start from one.
  it('refuses an unfilled template', () => {
    const r = checkScheme(schemeTemplate(homework), homework)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/Q1/)
  })

  const filled = schemeTemplate(homework).replace(/TODO[^\n]*/g, 'written')

  it('accepts a filled scheme', () => {
    expect(checkScheme(filled, homework)).toEqual({ ok: true, problems: [] })
  })

  it('refuses a scheme that lost a question the teacher set', () => {
    const r = checkScheme(filled.replace(/## Q2[\s\S]*?(?=\n## |$)/, ''), homework)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/Q2/)
  })

  it('refuses a stale scheme', () => {
    const r = checkScheme(filled, { ...homework, fingerprint: 'other' })
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/paper, key or marks changed/i)
  })

  it('without a breakdown, asks for one section per question and checks none is blank', () => {
    const open = { ...homework, breakdown: [] }
    const t = schemeTemplate(open)
    expect(t).toMatch(/one section per question/i)
    expect(checkScheme(t, open).ok).toBe(false)
    expect(checkScheme(t.replace(/TODO[^\n]*/g, 'written'), open).ok).toBe(true)
  })
})
