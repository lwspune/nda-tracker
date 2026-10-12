import { describe, it, expect } from 'vitest'
import {
  assignmentState, canStartSubmission, liveSubmission, submissionRoster, validateAssignmentForPublish,
} from '../status'

const NOW = new Date('2026-10-12T10:00:00Z')
const LATER = '2026-10-13T10:00:00Z'
const EARLIER = '2026-10-11T10:00:00Z'

const published = (over = {}) => ({ id: 'a1', status: 'published', dueAt: LATER, ...over })

describe('assignmentState', () => {
  it('is draft, open or closed', () => {
    expect(assignmentState(published({ status: 'draft' }), NOW)).toBe('draft')
    expect(assignmentState(published(), NOW)).toBe('open')
    expect(assignmentState(published({ dueAt: EARLIER }), NOW)).toBe('closed')
  })

  // Upload closes AT the due time, not a minute after: the same boundary as quiz-submit.
  it('is closed at exactly the due time', () => {
    expect(assignmentState(published({ dueAt: NOW.toISOString() }), NOW)).toBe('closed')
  })

  it('treats an unreadable due time as closed rather than open forever', () => {
    expect(assignmentState(published({ dueAt: 'not a date' }), NOW)).toBe('closed')
    expect(assignmentState(published({ dueAt: null }), NOW)).toBe('closed')
  })
})

describe('liveSubmission', () => {
  it('is the submitted or graded one; uploading and rejected do not count', () => {
    expect(liveSubmission([{ status: 'rejected' }, { status: 'uploading' }])).toBeNull()
    expect(liveSubmission([{ status: 'rejected' }, { id: 's2', status: 'graded' }])).toMatchObject({ id: 's2' })
    expect(liveSubmission([])).toBeNull()
    expect(liveSubmission(undefined)).toBeNull()
  })
})

describe('canStartSubmission', () => {
  it('allows a first submission while open', () => {
    expect(canStartSubmission(published(), [], NOW)).toEqual({ ok: true })
  })

  it('refuses after the deadline and on a draft', () => {
    expect(canStartSubmission(published({ dueAt: EARLIER }), [], NOW)).toMatchObject({ ok: false })
    expect(canStartSubmission(published({ status: 'draft' }), [], NOW)).toMatchObject({ ok: false })
  })

  it('refuses a second submission — one per student', () => {
    expect(canStartSubmission(published(), [{ status: 'submitted' }], NOW)).toMatchObject({ ok: false })
    expect(canStartSubmission(published(), [{ status: 'graded' }], NOW)).toMatchObject({ ok: false })
  })

  // A rejected sheet (unreadable photo) and an abandoned upload both leave the
  // student free to try again while the assignment is open.
  it('allows a fresh try after a rejection or an abandoned upload', () => {
    expect(canStartSubmission(published(), [{ status: 'rejected' }], NOW)).toEqual({ ok: true })
    expect(canStartSubmission(published(), [{ status: 'uploading' }], NOW)).toEqual({ ok: true })
  })
})

describe('submissionRoster', () => {
  const members = [
    { lwsId: 'L1', name: 'Aarav' },
    { lwsId: 'L2', name: 'Bhavya' },
    { lwsId: 'L3', name: 'Chetan' },
  ]

  it('gives every member one row, with the live submission\'s status or not_submitted', () => {
    const rows = submissionRoster(members, [
      { id: 's1', lwsId: 'L1', status: 'graded', totalAwarded: 8, totalMax: 10 },
      { id: 's0', lwsId: 'L2', status: 'rejected' },
      { id: 's9', lwsId: 'L3', status: 'uploading' },
    ])
    expect(rows.map(r => [r.lwsId, r.status])).toEqual([
      ['L1', 'graded'], ['L2', 'rejected'], ['L3', 'not_submitted'],
    ])
    expect(rows[0].submission).toMatchObject({ id: 's1', totalAwarded: 8 })
  })

  it('prefers a live submission over an earlier rejected one', () => {
    const rows = submissionRoster([members[0]], [
      { id: 'old', lwsId: 'L1', status: 'rejected' },
      { id: 'new', lwsId: 'L1', status: 'submitted' },
    ])
    expect(rows[0]).toMatchObject({ status: 'submitted', submission: { id: 'new' } })
  })

  // Batch membership is current; the assignment is historical. A student who has
  // since moved batch still appears, or their graded work would vanish from view.
  it('keeps a submitter who is no longer a member', () => {
    const rows = submissionRoster([members[0]], [
      { id: 's5', lwsId: 'L5', studentName: 'Esha', status: 'submitted' },
    ])
    expect(rows.map(r => [r.lwsId, r.name, r.status])).toEqual([
      ['L1', 'Aarav', 'not_submitted'], ['L5', 'Esha', 'submitted'],
    ])
  })
})

describe('validateAssignmentForPublish', () => {
  const good = {
    title: 'Limits — exercise 2',
    subject: 'Maths',
    batchNames: ['12th_A'],
    dueAt: LATER,
    maxMarks: 20,
    questionFiles: [{ path: 'a1/questions/01.pdf' }],
    questions: [],
  }

  it('passes a complete assignment', () => {
    expect(validateAssignmentForPublish(good, NOW)).toEqual({ ok: true, errors: [] })
  })

  it('names every missing piece', () => {
    const r = validateAssignmentForPublish({
      ...good, title: ' ', batchNames: [], dueAt: EARLIER, maxMarks: 0, questionFiles: [],
    }, NOW)
    expect(r.ok).toBe(false)
    expect(r.errors).toHaveLength(5)
  })

  // Homework is often just "Exercise 3.2, Q1–10, as announced in class" — a
  // description with no paper to upload. Either one is enough; neither is not.
  it('accepts a description in place of a question paper', () => {
    const r = validateAssignmentForPublish(
      { ...good, questionFiles: [], instructions: 'Exercise 3.2, Q1-10 from RD Sharma' }, NOW,
    )
    expect(r).toEqual({ ok: true, errors: [] })
  })

  it('refuses homework with neither a description nor a question paper', () => {
    const r = validateAssignmentForPublish({ ...good, questionFiles: [], instructions: '   ' }, NOW)
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual(['Describe the homework or upload the question paper.'])
  })

  it('needs marks in halves', () => {
    expect(validateAssignmentForPublish({ ...good, maxMarks: 7.3 }, NOW).ok).toBe(false)
    expect(validateAssignmentForPublish({ ...good, maxMarks: 7.5 }, NOW).ok).toBe(true)
  })

  it('checks an optional question breakdown adds up and has unique labels', () => {
    const qs = [{ label: 'Q1', marks: 10 }, { label: 'Q2', marks: 10 }]
    expect(validateAssignmentForPublish({ ...good, questions: qs }, NOW).ok).toBe(true)
    expect(validateAssignmentForPublish({ ...good, questions: [qs[0]] }, NOW).ok).toBe(false)
    expect(validateAssignmentForPublish({ ...good, questions: [qs[0], { label: 'Q1', marks: 10 }] }, NOW).ok).toBe(false)
    expect(validateAssignmentForPublish({ ...good, questions: [qs[0], { label: '', marks: 10 }] }, NOW).ok).toBe(false)
  })
})
