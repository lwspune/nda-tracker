import { describe, it, expect } from 'vitest'
import { resolveStudent as resolveWith, studentHomeworkList, planSubmissionUploads, markedPaperPaths, KEEP_CLOSED_DAYS } from '../studentHomework'
import { normMobile } from '../../../../api/_mobile.js'

// The endpoint passes its own normaliser in (api/_mobile.js stays the one
// server-side copy); the tests do the same.
const resolveStudent = (students, mobile, lwsId) => resolveWith(students, mobile, lwsId, normMobile)

const DAY = 864e5
const NOW = new Date('2026-10-12T10:00:00Z')
const iso = ms => new Date(ms).toISOString()

const student = (over = {}) => ({
  canonical_name: 'Arjun Sharma', lws_id: 'L1', mobile: '9876543210', account_status: 'Active',
  student_batches: [{ batch_name: '12th_A' }], ...over,
})

describe('resolveStudent', () => {
  it('finds the student by their own mobile', () => {
    expect(resolveStudent([student()], '9876543210', 'L1')).toMatchObject({ ok: true, student: { lws_id: 'L1' }, batches: ['12th_A'] })
  })

  it('normalises the number (+91, spaces)', () => {
    expect(resolveStudent([student()], '+91 98765 43210', 'L1').ok).toBe(true)
  })

  it('404s an unknown number', () => {
    expect(resolveStudent([student()], '9999999999', 'L1')).toMatchObject({ ok: false, status: 404 })
  })

  // The ID must belong to the number: siblings can share one, and a typed or
  // forged ID must not reach another student's homework.
  it('picks the named sibling, and refuses an ID that is not on that number', () => {
    const twins = [student(), student({ lws_id: 'L2', canonical_name: 'Riya Sharma' })]
    expect(resolveStudent(twins, '9876543210', 'L2')).toMatchObject({ ok: true, student: { lws_id: 'L2' } })
    expect(resolveStudent(twins, '9876543210', 'L9')).toMatchObject({ ok: false, status: 404 })
    expect(resolveStudent([student()], '9876543210', 'L2')).toMatchObject({ ok: false, status: 404 })
  })

  it('requires the ID', () => {
    expect(resolveStudent([student()], '9876543210', '')).toMatchObject({ ok: false, status: 400 })
  })

  // Same gate as login: blocked accounts are refused; a blank status is a legacy row and passes.
  it('refuses a blocked account and passes a blank status', () => {
    expect(resolveStudent([student({ account_status: 'Block' })], '9876543210', 'L1')).toMatchObject({ ok: false, status: 403 })
    expect(resolveStudent([student({ account_status: '' })], '9876543210', 'L1').ok).toBe(true)
  })
})

const row = (over = {}) => ({
  id: 'a1', title: 'Limits', subject: 'Maths', instructions: 'Show working', batch_names: ['12th_A'],
  question_files: [{ path: 'a1/questions/01.pdf', name: 'limits.pdf', type: 'application/pdf', size: 9 }],
  answer_key_files: [{ path: 'a1/key/01.pdf', name: 'key.pdf' }], questions: [],
  max_marks: '10', due_at: iso(NOW.getTime() + DAY), status: 'published', created_by: 'teach@x', ...over,
})

describe('studentHomeworkList', () => {
  const urls = { 'a1/questions/01.pdf': 'https://signed/q1' }

  it('shows published homework for the student\'s batches, with signed question links', () => {
    const [hw] = studentHomeworkList({ assignments: [row()], submissions: [], batches: ['12th_A'], urls, now: NOW })
    expect(hw).toMatchObject({
      id: 'a1', title: 'Limits', instructions: 'Show working', maxMarks: 10, state: 'open', canSubmit: true,
      questionFiles: [{ name: 'limits.pdf', url: 'https://signed/q1' }], submission: null,
    })
  })

  // The answer key is for the grader only. It must not leave the server in any
  // form — not even its name.
  it('never includes the answer key or who set the homework', () => {
    const [hw] = studentHomeworkList({ assignments: [row()], submissions: [], batches: ['12th_A'], urls, now: NOW })
    const text = JSON.stringify(hw)
    expect(text).not.toMatch(/key\.pdf|a1\/key|answer_key|answerKey|teach@x|created_by|createdBy/)
  })

  it('drops a key path that was wrongly listed as a question file', () => {
    const r = row({ question_files: [{ path: 'a1/key/01.pdf', name: 'oops.pdf' }], instructions: 'x' })
    const [hw] = studentHomeworkList({ assignments: [r], submissions: [], batches: ['12th_A'], urls: { 'a1/key/01.pdf': 'https://signed/key' }, now: NOW })
    expect(hw.questionFiles).toEqual([])
  })

  it('hides drafts and other batches\' homework', () => {
    const list = studentHomeworkList({
      assignments: [row({ status: 'draft' }), row({ id: 'a2', batch_names: ['12th_B'] })],
      submissions: [], batches: ['12th_A'], urls, now: NOW,
    })
    expect(list).toEqual([])
  })

  it('shows a closed homework with no submission as missed, until it is old', () => {
    const recent = row({ id: 'r', due_at: iso(NOW.getTime() - DAY) })
    const old = row({ id: 'o', due_at: iso(NOW.getTime() - (KEEP_CLOSED_DAYS + 1) * DAY) })
    const list = studentHomeworkList({ assignments: [recent, old], submissions: [], batches: ['12th_A'], urls, now: NOW })
    expect(list.map(h => [h.id, h.state, h.canSubmit])).toEqual([['r', 'closed', false]])
  })

  it('keeps old homework that the student handed in', () => {
    const old = row({ id: 'o', due_at: iso(NOW.getTime() - 90 * DAY) })
    const list = studentHomeworkList({
      assignments: [old], batches: ['12th_A'], urls, now: NOW,
      submissions: [{ id: 's', assignment_id: 'o', status: 'graded', files: ['x'], created_at: iso(0), total_awarded: '7', total_max: '10', homework_grades: [] }],
    })
    expect(list.map(h => h.id)).toEqual(['o'])
  })

  it('attaches the student\'s submission with its grade, ordered by question', () => {
    const [hw] = studentHomeworkList({
      assignments: [row()], batches: ['12th_A'], urls, now: NOW,
      submissions: [{
        id: 's1', assignment_id: 'a1', status: 'graded', files: ['a1/L1/s1/01.jpg', 'a1/L1/s1/02.jpg'],
        created_at: iso(NOW.getTime() - 3600e3), submitted_at: iso(NOW.getTime() - 3600e3),
        total_awarded: '7.5', total_max: '10', went_well: 'Good', next_steps: 'Revise',
        homework_grades: [
          { position: 2, label: 'Q2', max_marks: '5', outcome: 'scored', awarded: '2.5', earned: 'Part', missing: 'Unit' },
          { position: 1, label: 'Q1', max_marks: '5', outcome: 'scored', awarded: '5', earned: 'All', missing: null },
        ],
      }],
    })
    expect(hw.canSubmit).toBe(false)
    expect(hw.submission).toMatchObject({ status: 'graded', pages: 2, totalAwarded: 7.5, totalMax: 10, wentWell: 'Good' })
    expect(hw.submission.grades.map(g => [g.label, g.awarded])).toEqual([['Q1', 5], ['Q2', 2.5]])
    expect(hw.submission).not.toHaveProperty('files')
  })

  // 2026-10-16: the marked-paper report. The marked pages and the PDF are
  // signed by the endpoint; the shape carries a link only when it was signed.
  describe('the marked paper', () => {
    const graded = (over = {}) => ({
      id: 's1', assignment_id: 'a1', lws_id: 'L1', status: 'graded', files: ['a1/L1/s1/01.jpg'],
      created_at: iso(1), submitted_at: iso(1), graded_at: iso(2), total_awarded: '3', total_max: '10',
      went_well: 'G', next_steps: 'N', marked_pages: 2, scans_deleted_at: null,
      homework_grades: [
        { position: 1, label: 'Q1', max_marks: '5', outcome: 'scored', awarded: '3', earned: 'e', missing: 'm', cause: 'concept', topic: 'Chain rule' },
        { position: 2, label: 'Q2', max_marks: '5', outcome: 'not_attempted', awarded: null, earned: null, missing: null, cause: null, topic: null },
      ],
      ...over,
    })
    const signed = {
      ...urls,
      'a1/L1/s1/marked/01.jpg': 'https://signed/p1',
      'a1/L1/s1/marked/02.jpg': 'https://signed/p2',
      'a1/L1/s1/marked/report.pdf': 'https://signed/report',
    }
    const shape = (sub, u = signed) => studentHomeworkList({ assignments: [row()], batches: ['12th_A'], urls: u, now: NOW, submissions: [sub] })[0].submission

    it('names the paths to sign: a released grade\'s marked pages and its PDF, nothing else', () => {
      expect(markedPaperPaths([graded()])).toEqual([
        'a1/L1/s1/marked/01.jpg', 'a1/L1/s1/marked/02.jpg', 'a1/L1/s1/marked/report.pdf',
      ])
      expect(markedPaperPaths([graded({ status: 'held' })])).toEqual([])
      expect(markedPaperPaths([graded({ status: 'submitted' })])).toEqual([])
      expect(markedPaperPaths([graded({ scans_deleted_at: iso(3) })])).toEqual([])
      expect(markedPaperPaths([graded({ marked_pages: null })])).toEqual([])
    })

    it('gives a released grade its marked pages, its PDF and each question\'s cause and topic', () => {
      const sub = shape(graded())
      expect(sub.markedPages).toEqual(['https://signed/p1', 'https://signed/p2'])
      expect(sub.reportUrl).toBe('https://signed/report')
      expect(sub.pagesRemoved).toBe(false)
      expect(sub.grades[0]).toMatchObject({ cause: 'concept', topic: 'Chain rule' })
      expect(sub.grades[1]).toMatchObject({ cause: null, topic: null })
    })

    it('says the pages were removed after 30 days, and links nothing', () => {
      const sub = shape(graded({ scans_deleted_at: iso(3) }))
      expect(sub).toMatchObject({ markedPages: [], reportUrl: null, pagesRemoved: true })
    })

    it('links nothing for a grade saved before page marks', () => {
      expect(shape(graded({ marked_pages: null }), urls)).toMatchObject({ markedPages: [], reportUrl: null, pagesRemoved: false })
    })

    // Even if a link for a held grade's pages were somehow signed, the held
    // shape must not carry it.
    it('never carries marked pages or a PDF on a held grade', () => {
      const held = shape(graded({ status: 'held', hand_check: 'mismatch', hand_note: 'x' }))
      const waiting = shape(graded({
        status: 'submitted', graded_at: null, total_awarded: null, total_max: null,
        went_well: null, next_steps: null, marked_pages: null, homework_grades: [],
      }))
      expect(held).toEqual(waiting)
      expect(JSON.stringify(held)).not.toMatch(/signed\/(p1|p2|report)/)
    })
  })

  // A grade held for a handwriting check must be indistinguishable from one
  // not yet graded: no marks, no feedback, no flag. Telling the student their
  // grade is held is telling them they were suspected.
  it('shows a held grade exactly as waiting to be graded', () => {
    const base = {
      id: 's1', assignment_id: 'a1', files: ['a1/L1/s1/01.jpg'],
      created_at: iso(NOW.getTime() - 3600e3), submitted_at: iso(NOW.getTime() - 3600e3),
    }
    const [waiting] = studentHomeworkList({
      assignments: [row()], batches: ['12th_A'], urls, now: NOW,
      submissions: [{ ...base, status: 'submitted', homework_grades: [] }],
    })
    const [held] = studentHomeworkList({
      assignments: [row()], batches: ['12th_A'], urls, now: NOW,
      submissions: [{
        ...base, status: 'held', graded_at: iso(NOW.getTime() - 60e3), grader: 'session',
        total_awarded: '7', total_max: '10', went_well: 'Good', next_steps: 'Revise',
        hand_check: 'mismatch', hand_note: 'Different hand', hand_reference_id: 'r1',
        homework_grades: [{ position: 1, label: 'Q1', max_marks: '10', outcome: 'scored', awarded: '7', earned: 'x', missing: 'y' }],
      }],
    })
    expect(held).toEqual(waiting)
    expect(held.canSubmit).toBe(false)
    // Same Replace as a waiting one: a missing button would give the hold away.
    expect(held).toMatchObject({ canReplace: true, replacementsLeft: 2 })
  })

  // 2026-10-14: replacing a hand-in that has not been marked yet.
  it('offers Replace on a hand-in waiting to be graded, with how many are left', () => {
    const [hw] = studentHomeworkList({
      assignments: [row()], batches: ['12th_A'], urls, now: NOW,
      submissions: [
        { id: 'old', assignment_id: 'a1', status: 'replaced', files: ['a', 'b'], created_at: iso(1), submitted_at: iso(1), homework_grades: [] },
        { id: 'new', assignment_id: 'a1', status: 'submitted', files: ['c', 'd', 'e'], created_at: iso(2), submitted_at: iso(2), homework_grades: [] },
      ],
    })
    expect(hw).toMatchObject({ canSubmit: false, canReplace: true, replacementsLeft: 1 })
    // The newest hand-in is the one shown; the replaced one never is.
    expect(hw.submission).toMatchObject({ id: 'new', status: 'submitted', pages: 3 })
  })

  it('offers no Replace once graded, after the deadline, or before a hand-in', () => {
    const sub = status => ({ id: 's1', assignment_id: 'a1', status, files: ['x'], created_at: iso(1), submitted_at: iso(1),
      graded_at: iso(2), grader: 'session', total_awarded: '7', total_max: '10', went_well: 'G', next_steps: 'N', homework_grades: [] })
    const list = (over, submissions) => studentHomeworkList({ assignments: [row(over)], batches: ['12th_A'], urls, now: NOW, submissions })[0]
    expect(list({}, [sub('graded')]).canReplace).toBe(false)
    expect(list({ due_at: iso(NOW.getTime() - 60e3) }, [{ ...sub('submitted'), graded_at: null }]).canReplace).toBe(false)
    expect(list({}, []).canReplace).toBe(false)
  })

  it('never sends a student any handwriting field, whatever the status', () => {
    for (const status of ['submitted', 'held', 'graded', 'rejected', 'replaced']) {
      const [hw] = studentHomeworkList({
        assignments: [row()], batches: ['12th_A'], urls, now: NOW,
        submissions: [{
          id: 's1', assignment_id: 'a1', status, files: ['x'], created_at: iso(1), submitted_at: iso(1),
          graded_at: iso(2), total_awarded: '7', total_max: '10', went_well: 'G', next_steps: 'N', rejected_reason: 'R',
          hand_check: 'mismatch', hand_note: 'Different hand', hand_reference_id: 'r1', resolved_by: 'asha@lws.com',
          homework_grades: [],
        }],
      })
      expect(JSON.stringify(hw), status).not.toMatch(/hand|resolved|Different hand|asha/i)
    }
  })

  it('lets the student try again after a rejection while open, and shows why', () => {
    const [hw] = studentHomeworkList({
      assignments: [row()], batches: ['12th_A'], urls, now: NOW,
      submissions: [{ id: 's0', assignment_id: 'a1', status: 'rejected', files: ['x'], created_at: iso(1), rejected_reason: 'Blurry' }],
    })
    expect(hw).toMatchObject({ canSubmit: true, submission: { status: 'rejected', rejectedReason: 'Blurry' } })
  })

  it('ignores an unfinished upload', () => {
    const [hw] = studentHomeworkList({
      assignments: [row()], batches: ['12th_A'], urls, now: NOW,
      submissions: [{ id: 'u', assignment_id: 'a1', status: 'uploading', files: ['x'], created_at: iso(1) }],
    })
    expect(hw).toMatchObject({ canSubmit: true, submission: null })
  })

  it('lists open homework soonest-due first, then closed most-recent first', () => {
    const list = studentHomeworkList({
      assignments: [
        row({ id: 'late', due_at: iso(NOW.getTime() + 3 * DAY) }),
        row({ id: 'soon', due_at: iso(NOW.getTime() + DAY) }),
        row({ id: 'gone', due_at: iso(NOW.getTime() - 2 * DAY) }),
        row({ id: 'just', due_at: iso(NOW.getTime() - DAY) }),
      ],
      submissions: [], batches: ['12th_A'], urls, now: NOW,
    })
    expect(list.map(h => h.id)).toEqual(['soon', 'late', 'just', 'gone'])
  })
})

describe('planSubmissionUploads', () => {
  it('builds one path per file in page order', () => {
    const r = planSubmissionUploads('a1', 'L1', 's1', [{ type: 'image/jpeg', size: 10 }, { type: 'application/pdf', size: 20 }])
    expect(r).toEqual({ ok: true, paths: ['a1/L1/s1/01.jpg', 'a1/L1/s1/02.pdf'] })
  })

  it('refuses what the upload rules refuse', () => {
    expect(planSubmissionUploads('a1', 'L1', 's1', [{ type: 'image/heic', size: 10 }]).ok).toBe(false)
    expect(planSubmissionUploads('a1', 'L1', 's1', []).ok).toBe(false)
  })
})
