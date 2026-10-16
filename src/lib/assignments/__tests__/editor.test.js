import { describe, it, expect } from 'vitest'
import {
  istLocalToIso, isoToIstLocal, fmtDeadline, homeworkTargets, visibleAssignments,
  planFileUploads, buildAssignmentRow, mapAssignmentRow, mapSubmissionRow, blankAssignment,
} from '../editor'
import { MAX_FILE_BYTES } from '../upload'

describe('IST deadline conversion', () => {
  // The deadline is a wall-clock time in Pune, whatever timezone the browser
  // that typed it is set to: 6 pm IST is 12:30 UTC.
  it('reads a datetime-local value as IST', () => {
    expect(istLocalToIso('2026-10-13T18:00')).toBe('2026-10-13T12:30:00.000Z')
  })

  it('round-trips', () => {
    expect(isoToIstLocal('2026-10-13T12:30:00.000Z')).toBe('2026-10-13T18:00')
    expect(isoToIstLocal(istLocalToIso('2026-12-31T23:59'))).toBe('2026-12-31T23:59')
  })

  it('crosses a date boundary correctly', () => {
    expect(istLocalToIso('2026-10-13T02:00')).toBe('2026-10-12T20:30:00.000Z')
  })

  it('returns null / empty for missing or malformed input', () => {
    expect(istLocalToIso('')).toBeNull()
    expect(istLocalToIso('tomorrow')).toBeNull()
    expect(isoToIstLocal(null)).toBe('')
  })

  // The app's one date format (lib/dates.js) plus the IST clock time, since a
  // deadline is a moment, not a day.
  it('formats a deadline as an IST date and time', () => {
    expect(fmtDeadline('2026-10-13T12:30:00.000Z')).toBe('13 Oct 2026, 6:00 pm')
    expect(fmtDeadline('2026-10-13T06:35:00.000Z')).toBe('13 Oct 2026, 12:05 pm')
    expect(fmtDeadline('2026-10-12T18:30:00.000Z')).toBe('13 Oct 2026, 12:00 am')
    expect(fmtDeadline(null)).toBe('')
  })
})

describe('homeworkTargets', () => {
  it('gives a teacher exactly their own subject → batch pairs', () => {
    const t = homeworkTargets({
      mode: 'teacher',
      subjectBatches: [
        { subject: 'Maths', batchName: '12th_A' },
        { subject: 'Maths', batchName: '12th_B' },
        { subject: 'Physics', batchName: '12th_A' },
      ],
    })
    expect(t).toEqual({ Maths: ['12th_A', '12th_B'], Physics: ['12th_A'] })
  })

  // Falls closed, like every other teacher scope: a teacher with no timetable
  // classes can set nothing, rather than everything.
  it('gives a teacher with no classes nothing', () => {
    expect(homeworkTargets({ mode: 'teacher', subjectBatches: [] })).toEqual({})
  })

  it('gives an admin every subject with every batch', () => {
    const t = homeworkTargets({ mode: 'admin', allSubjects: ['Maths', 'GAT'], allBatches: ['12th_A', '6M'] })
    expect(t).toEqual({ Maths: ['12th_A', '6M'], GAT: ['12th_A', '6M'] })
  })
})

describe('visibleAssignments', () => {
  const list = [
    { id: 'a', createdBy: 'asha@lws.com' },
    { id: 'b', createdBy: 'ravi@lws.com' },
  ]
  it('shows a teacher only what they created, matching email case-insensitively', () => {
    expect(visibleAssignments(list, { mode: 'teacher', email: 'Asha@LWS.com' }).map(a => a.id)).toEqual(['a'])
  })
  it('shows a teacher with no email nothing', () => {
    expect(visibleAssignments(list, { mode: 'teacher', email: '' })).toEqual([])
  })
  it('shows an admin everything', () => {
    expect(visibleAssignments(list, { mode: 'admin', email: 'x' })).toHaveLength(2)
  })
})

describe('planFileUploads', () => {
  const A = '11111111-1111-1111-1111-111111111111'
  const f = (name, type = 'application/pdf', size = 100) => ({ name, type, size })

  it('numbers new files after the ones already uploaded', () => {
    const r = planFileUploads(A, 'question', 1, [f('p2.pdf'), f('p3.jpg', 'image/jpeg')])
    expect(r.ok).toBe(true)
    expect(r.uploads.map(u => u.path)).toEqual([`${A}/questions/02.pdf`, `${A}/questions/03.jpg`])
    expect(r.uploads[0].meta).toEqual({ path: `${A}/questions/02.pdf`, name: 'p2.pdf', type: 'application/pdf', size: 100 })
    expect(r.uploads[0].file.name).toBe('p2.pdf')
  })

  it('refuses a file the grader cannot read, or one too big', () => {
    expect(planFileUploads(A, 'key', 0, [f('a.docx', 'application/msword')]).ok).toBe(false)
    expect(planFileUploads(A, 'key', 0, [f('a.pdf', 'application/pdf', MAX_FILE_BYTES + 1)]).ok).toBe(false)
  })

  it('is a no-op for no files', () => {
    expect(planFileUploads(A, 'question', 0, [])).toEqual({ ok: true, uploads: [] })
  })
})

describe('row mapping', () => {
  const a = {
    ...blankAssignment('teach@x'),
    id: 'id1', title: ' Limits ', subject: 'Maths', branch: 'APJ', batchNames: ['12th_A'],
    instructions: '  Show working  ', questionFiles: [{ path: 'id1/questions/01.pdf' }],
    maxMarks: 20, dueAt: '2026-10-13T12:30:00.000Z', status: 'published',
    questions: [{ label: 'Q1', marks: 20 }],
  }

  it('builds a row with trimmed text and null for blank instructions', () => {
    const row = buildAssignmentRow(a)
    expect(row).toMatchObject({
      id: 'id1', title: 'Limits', subject: 'Maths', branch: 'APJ', batch_names: ['12th_A'],
      instructions: 'Show working', question_files: [{ path: 'id1/questions/01.pdf' }],
      answer_key_files: [], questions: [{ label: 'Q1', marks: 20 }], max_marks: 20,
      due_at: '2026-10-13T12:30:00.000Z', status: 'published', created_by: 'teach@x',
    })
    expect(buildAssignmentRow({ ...a, instructions: '   ' }).instructions).toBeNull()
    expect(buildAssignmentRow({ ...a, branch: '' }).branch).toBeNull()
  })

  // The row never carries created_at: an update must not move it, and the
  // database fills it on insert.
  it('leaves created_at to the database', () => {
    expect(buildAssignmentRow(a)).not.toHaveProperty('created_at')
  })

  it('round-trips through the row shape', () => {
    const back = mapAssignmentRow({ ...buildAssignmentRow(a), created_at: '2026-10-12T00:00:00Z' })
    expect(back).toMatchObject({
      id: 'id1', title: 'Limits', batchNames: ['12th_A'], maxMarks: 20,
      questionFiles: [{ path: 'id1/questions/01.pdf' }], createdBy: 'teach@x', createdAt: '2026-10-12T00:00:00Z',
    })
  })

  it('reads numeric columns that PostgREST returns as strings', () => {
    expect(mapAssignmentRow({ ...buildAssignmentRow(a), max_marks: '7.5' }).maxMarks).toBe(7.5)
    const s = mapSubmissionRow({
      id: 's', assignment_id: 'id1', lws_id: 'L1', student_name: 'Aarav', status: 'graded',
      files: ['p/01.jpg'], total_awarded: '7.5', total_max: '10', submitted_at: 't',
      homework_grades: [{ position: 2, label: 'Q2', max_marks: '5', outcome: 'scored', awarded: '2.5', earned: 'x', missing: 'y' },
                        { position: 1, label: 'Q1', max_marks: '5', outcome: 'not_attempted', awarded: null, earned: null, missing: null }],
    })
    expect(s).toMatchObject({ lwsId: 'L1', studentName: 'Aarav', totalAwarded: 7.5, totalMax: 10, files: ['p/01.jpg'] })
    expect(s.grades.map(g => [g.position, g.awarded])).toEqual([[1, null], [2, 2.5]])
  })

  // 2026-10-16: staff open the marked pages and the report from the detail.
  it('carries each question\'s cause and the marked paper\'s storage paths', () => {
    const s = mapSubmissionRow({
      id: 's', assignment_id: 'id1', lws_id: 'L1', student_name: 'Aarav', status: 'graded', files: ['p/01.jpg'],
      marked_pages: 2, scans_deleted_at: null,
      homework_grades: [{ position: 1, label: 'Q1', max_marks: '5', outcome: 'scored', awarded: '3', earned: 'x', missing: 'y', cause: 'concept', topic: 'Chain rule' }],
    })
    expect(s.grades[0]).toMatchObject({ cause: 'concept', topic: 'Chain rule' })
    expect(s.markedPages).toEqual(['id1/L1/s/marked/01.jpg', 'id1/L1/s/marked/02.jpg'])
    expect(s.reportPath).toBe('id1/L1/s/marked/report.pdf')
    expect(mapSubmissionRow({ id: 's', assignment_id: 'id1', lws_id: 'L1', status: 'graded', files: [], marked_pages: 1, report_emailed_at: 't', homework_grades: [] }).reportEmailedAt).toBe('t')
    const old = mapSubmissionRow({ id: 's', assignment_id: 'id1', lws_id: 'L1', status: 'graded', files: [], homework_grades: [] })
    expect(old).toMatchObject({ markedPages: [], reportPath: null, reportEmailedAt: null })
  })

  it('carries the handwriting check for faculty', () => {
    const s = mapSubmissionRow({
      id: 's', assignment_id: 'id1', lws_id: 'L1', student_name: 'Aarav', status: 'held', files: ['p/01.jpg'],
      hand_check: 'mismatch', hand_note: 'Different hand', hand_reference_id: 'r1',
      resolved_at: null, resolved_by: null, homework_grades: [],
    })
    expect(s).toMatchObject({ handCheck: 'mismatch', handNote: 'Different hand', handReferenceId: 'r1', resolvedAt: null, resolvedBy: null })
    expect(mapSubmissionRow({ id: 's', status: 'graded', files: [], homework_grades: [] })).toMatchObject({ handCheck: null, handNote: null })
  })
})
