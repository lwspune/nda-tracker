import { describe, it, expect } from 'vitest'
import { buildHomeworkBrief, gradeTemplate, savedGradeFile, commitRows } from '../brief'
import { validateGrade } from '../grade'

const assignment = (over = {}) => ({
  id: 'a1', title: 'Limits — Exercise 2.3', subject: 'Maths', instructions: 'Show all working.',
  max_marks: '20', due_at: '2026-10-14T12:30:00.000Z', questions: [], batch_names: ['12th_A'],
  question_files: [{ path: 'a1/questions/01.pdf', name: 'limits.pdf' }],
  answer_key_files: [{ path: 'a1/key/01.pdf', name: 'key.pdf' }],
  ...over,
})
const submission = (over = {}) => ({
  id: 's1', assignment_id: 'a1', lws_id: 'L1', student_name: 'Arjun Sharma', status: 'submitted',
  files: ['a1/L1/s1/01.jpg', 'a1/L1/s1/02.jpg'], submitted_at: '2026-10-13T10:00:00.000Z', ...over,
})

describe('buildHomeworkBrief', () => {
  const text = buildHomeworkBrief({
    submission: submission(), assignment: assignment(),
    files: { questions: ['paper/01.pdf'], key: ['key/01.pdf'], scans: ['scans/01.jpg', 'scans/02.jpg'] },
  })

  it('names the homework, its marks, deadline and where everything is', () => {
    expect(text).toMatch(/# Limits — Exercise 2\.3/)
    expect(text).toMatch(/Submission: s1/)
    expect(text).toMatch(/out of 20/i)
    expect(text).toMatch(/14 Oct 2026, 6:00 pm/)
    expect(text).toMatch(/Show all working\./)
    expect(text).toMatch(/paper\/01\.pdf/)
    expect(text).toMatch(/key\/01\.pdf/)
    expect(text).toMatch(/scans\/01\.jpg[\s\S]*scans\/02\.jpg/)
  })

  // Graded work must not carry a student's identity into a chat transcript
  // beyond what grading needs: the brief names no student.
  it('does not name the student', () => {
    expect(text).not.toMatch(/Arjun|L1\b/)
  })

  it('tells the grader to read the questions from the description when there is no paper', () => {
    const t = buildHomeworkBrief({
      submission: submission(),
      assignment: assignment({ question_files: [], answer_key_files: [], instructions: 'RD Sharma Ex 3.2, Q1-10' }),
      files: { questions: [], key: [], scans: ['scans/01.jpg'] },
    })
    expect(t).toMatch(/no question paper/i)
    expect(t).toMatch(/RD Sharma Ex 3\.2, Q1-10/)
    expect(t).toMatch(/no answer key/i)
  })

  it('points the grader at the student\'s reference pages for the handwriting check', () => {
    const t = buildHomeworkBrief({
      submission: submission(), assignment: assignment(),
      files: { questions: [], key: [], scans: ['scans/01.jpg'], reference: ['reference/01.jpg', 'reference/02.jpg'] },
    })
    expect(t).toMatch(/## Handwriting check/)
    expect(t).toMatch(/reference\/01\.jpg[\s\S]*reference\/02\.jpg/)
    expect(t).toMatch(/match.*mismatch.*unclear/s)
    expect(t).not.toMatch(/no_reference/)
  })

  it('says there is no reference yet, and that this one becomes it', () => {
    const t = buildHomeworkBrief({
      submission: submission(), assignment: assignment(),
      files: { questions: [], key: [], scans: ['scans/01.jpg'], reference: [] },
    })
    expect(t).toMatch(/## Handwriting check/)
    expect(t).toMatch(/no_reference/)
    expect(t).toMatch(/becomes .*reference/i)
  })

  // 2026-10-16: the grader reads the PREPARED pages (upright, PDFs split) and
  // places marks off the grid copies; positions are percent of those pages.
  it('points the grader at the prepared pages and the grid, and the preview step', () => {
    const t = buildHomeworkBrief({
      submission: submission(), assignment: assignment(),
      files: {
        questions: [], key: [], scans: ['scans/01.pdf'],
        pages: ['pages/01.jpg', 'pages/02.jpg'], grid: ['grid/01.jpg', 'grid/02.jpg'],
      },
    })
    expect(t).toMatch(/## The student's work \(2 pages, in order\)/)
    expect(t).toMatch(/pages\/01\.jpg[\s\S]*pages\/02\.jpg/)
    expect(t).toMatch(/grid\/01\.jpg[\s\S]*grid\/02\.jpg/)
    expect(t).toMatch(/## Marks on the pages/)
    expect(t).toMatch(/npm run grading:preview -- s1/)
  })

  it('lists a teacher-set breakdown, which the grade must follow exactly', () => {
    const t = buildHomeworkBrief({
      submission: submission(),
      assignment: assignment({ questions: [{ label: 'Q1', marks: 12 }, { label: 'Q2', marks: 8 }] }),
      files: { questions: [], key: [], scans: [] },
    })
    expect(t).toMatch(/Q1 — 12 marks/)
    expect(t).toMatch(/Q2 — 8 marks/)
  })
})

describe('gradeTemplate', () => {
  // An unfilled template must never pass the checker: a question nobody
  // looked at cannot slip through as a grade.
  it('cannot pass the checker unfilled, with or without a breakdown', () => {
    for (const a of [assignment(), assignment({ questions: [{ label: 'Q1', marks: 20 }] })]) {
      const t = gradeTemplate('s1', a)
      expect(t.submissionId).toBe('s1')
      expect(validateGrade({ maxMarks: 20, questions: a.questions, file: t }).ok).toBe(false)
    }
  })

  it('pre-fills the teacher\'s questions at their marks', () => {
    const t = gradeTemplate('s1', assignment({ questions: [{ label: 'Q1', marks: '12' }, { label: 'Q2', marks: 8 }] }))
    expect(t.grades).toEqual([
      { label: 'Q1', max: 12, outcome: '', awarded: null, earned: '', missing: '', cause: '', topic: '' },
      { label: 'Q2', max: 8, outcome: '', awarded: null, earned: '', missing: '', cause: '', topic: '' },
    ])
  })

  it('starts with an empty marks list, which the marks checker refuses for a scored question', () => {
    expect(gradeTemplate('s1', assignment()).marks).toEqual([])
  })

  it('starts with an empty handwriting check to fill in', () => {
    expect(gradeTemplate('s1', assignment()).handwriting).toEqual({ check: '', note: '' })
  })

  it('leaves the rows to the grader when the teacher set no breakdown', () => {
    expect(gradeTemplate('s1', assignment()).grades).toEqual([])
  })
})

describe('savedGradeFile', () => {
  // A regrade starts from what was saved, so fixing one question does not mean
  // re-typing the rest.
  it('turns a saved grade back into a grade.json that passes the checker unchanged', () => {
    const file = savedGradeFile({
      ...submission({ status: 'graded', went_well: 'Good', next_steps: 'Revise', hand_check: 'match', hand_note: null }),
      homework_grades: [
        { position: 2, label: 'Q2', max_marks: '10', outcome: 'scored', awarded: '6', earned: 'Method', missing: 'Arithmetic', cause: 'concept', topic: 'Product rule' },
        { position: 1, label: 'Q1', max_marks: '10', outcome: 'not_attempted', awarded: null, earned: null, missing: null },
      ],
    })
    expect(file.grades.map(g => g.label)).toEqual(['Q1', 'Q2'])
    expect(file.grades[1]).toMatchObject({ cause: 'concept', topic: 'Product rule' })
    expect(file.grades[0]).toMatchObject({ cause: '', topic: '' })
    expect(file.handwriting).toEqual({ check: 'match', note: '' })
    expect(validateGrade({ maxMarks: 20, file }).ok).toBe(true)
  })

  // Grades saved before causes existed (2026-10-16) have none on their lost
  // marks; a regrade must name them.
  it('leaves the cause empty for lost marks saved before causes existed, which the checker refuses', () => {
    const file = savedGradeFile({
      ...submission({ status: 'graded', went_well: 'Good', next_steps: 'Revise', hand_check: 'match', hand_note: null }),
      homework_grades: [{ position: 1, label: 'Q1', max_marks: '20', outcome: 'scored', awarded: '12', earned: 'e', missing: 'm', cause: null, topic: null }],
    })
    expect(file.grades[0]).toMatchObject({ cause: '', topic: '' })
    expect(validateGrade({ maxMarks: 20, file }).errors.join(' ')).toMatch(/name the cause/)
  })

  it('reloads a held grade with its handwriting note, for a regrade', () => {
    const file = savedGradeFile({
      ...submission({ status: 'held', went_well: 'Good', next_steps: 'Revise', hand_check: 'mismatch', hand_note: 'Different hand' }),
      homework_grades: [{ position: 1, label: 'Q1', max_marks: '20', outcome: 'scored', awarded: '12', earned: 'e', missing: 'm' }],
    })
    expect(file.handwriting).toEqual({ check: 'mismatch', note: 'Different hand' })
  })

  // Grades saved before the check existed have none; a regrade must record one.
  it('leaves the check empty for a grade saved before it existed, which the checker refuses', () => {
    const file = savedGradeFile({
      ...submission({ status: 'graded', went_well: 'Good', next_steps: 'Revise' }),
      homework_grades: [{ position: 1, label: 'Q1', max_marks: '20', outcome: 'scored', awarded: '12', earned: 'e', missing: 'm' }],
    })
    expect(file.handwriting).toEqual({ check: '', note: '' })
    expect(validateGrade({ maxMarks: 20, file }).ok).toBe(false)
  })

  it('reloads the saved page marks in grade.json form, in order', () => {
    const file = savedGradeFile({
      ...submission({ status: 'graded', went_well: 'Good', next_steps: 'Revise', hand_check: 'match', hand_note: null }),
      homework_grades: [{ position: 1, label: 'Q1', max_marks: '20', outcome: 'scored', awarded: '12', earned: 'e', missing: 'm', cause: 'careless', topic: null }],
      homework_page_marks: [
        { position: 2, page: 1, label: 'Q1', kind: 'note', x: '70', y: '40', w: null, h: null, text: 'Sign', to_x: '50', to_y: '41.5' },
        { position: 3, page: 1, label: 'Q1', kind: 'circle', x: '50', y: '41', w: '8', h: '3', text: null, to_x: null, to_y: null },
        { position: 1, page: 1, label: 'Q1', kind: 'score', x: '85', y: '20', w: null, h: null, text: null, to_x: null, to_y: null },
      ],
    })
    expect(file.marks).toEqual([
      { page: 1, label: 'Q1', kind: 'score', x: 85, y: 20 },
      { page: 1, label: 'Q1', kind: 'note', x: 70, y: 40, text: 'Sign', to: { x: 50, y: 41.5 } },
      { page: 1, label: 'Q1', kind: 'circle', x: 50, y: 41, w: 8, h: 3 },
    ])
  })

  it('starts a regrade of a grade saved before page marks with an empty marks list', () => {
    const file = savedGradeFile({
      ...submission({ status: 'graded', went_well: 'Good', next_steps: 'Revise', hand_check: 'match' }),
      homework_grades: [],
    })
    expect(file.marks).toEqual([])
  })

  it('is null for a submission that was never graded', () => {
    expect(savedGradeFile(submission())).toBeNull()
  })
})

describe('commitRows', () => {
  it('shapes checked rows for homework_grade_commit', () => {
    const check = validateGrade({
      maxMarks: 10,
      file: { wentWell: 'w', nextSteps: 'n', handwriting: { check: 'match', note: '' }, grades: [{ label: 'Q1', max: 10, outcome: 'scored', awarded: 7, earned: 'e', missing: 'm', cause: 'incomplete', topic: 'Show the construction' }] },
    })
    expect(commitRows(check.rows)).toEqual([
      { position: 1, label: 'Q1', maxMarks: 10, outcome: 'scored', awarded: 7, earned: 'e', missing: 'm', cause: 'incomplete', topic: 'Show the construction' },
    ])
  })
})
