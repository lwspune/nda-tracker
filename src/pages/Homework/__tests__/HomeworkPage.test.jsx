import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModeContext } from '../../../context/ModeContext'

const LATER = new Date(Date.now() + 3 * 864e5).toISOString()

const mockStore = {}
function resetStore() {
  Object.assign(mockStore, {
    homeworkAssignments: [
      { id: 'a1', title: 'Limits worksheet', subject: 'Maths', batchNames: ['12th_A'], status: 'published',
        dueAt: LATER, maxMarks: 10, createdBy: 'asha@lws.com', questionFiles: [{ path: 'a1/questions/01.pdf', name: 'limits.pdf' }],
        answerKeyFiles: [], questions: [], instructions: '' },
      { id: 'a2', title: 'Optics problems', subject: 'Physics', batchNames: ['12th_B'], status: 'draft',
        dueAt: LATER, maxMarks: 20, createdBy: 'ravi@lws.com', questionFiles: [], answerKeyFiles: [], questions: [], instructions: '' },
    ],
    homeworkAssignmentsLoaded: true,
    loadHomeworkAssignments: vi.fn(),
    getHomeworkSubmissionStatuses: vi.fn(async () => [
      { assignmentId: 'a1', lwsId: 'L1', status: 'graded' },
    ]),
    getHomeworkSubmissions: vi.fn(async () => [
      { id: 's1', assignmentId: 'a1', lwsId: 'L1', studentName: 'Aarav Nair', status: 'graded', files: ['a1/L1/s1/01.jpg'],
        totalAwarded: 7.5, totalMax: 10, wentWell: 'Clear working', nextSteps: 'Revise', grades: [
          { position: 1, label: 'Q1', maxMarks: 10, outcome: 'scored', awarded: 7.5, earned: 'Method right', missing: 'Final answer' },
        ] },
    ]),
    getHomeworkFileUrl: vi.fn(async () => 'https://signed/x'),
    getHomeworkReferenceFiles: vi.fn(async () => ({ submissionId: 'r1', files: ['b/L2/r1/01.jpg', 'b/L2/r1/02.jpg'], scansDeletedAt: null })),
    resolveHeldHomework: vi.fn(async () => ({ ok: true })),
    saveHomeworkAssignment: vi.fn(async (a) => ({ ok: true, assignment: { ...a, id: 'new' } })),
    deleteHomeworkAssignment: vi.fn(async () => ({ ok: true })),
    removeHomeworkFile: vi.fn(async () => ({ ok: true })),
    timetableTeachers: [{ id: 't1', name: 'Asha', email: 'asha@lws.com' }],
    timetableMappings: [
      { id: 'm1', teacherId: 't1', subject: 'Maths' },
    ],
    timetables: [
      { batchName: '12th_A', grid: { s1: { Mon: { type: 'class', mappingId: 'm1' } } } },
      { batchName: '6M',     grid: { s1: { Tue: { type: 'class', mappingId: 'm1' } } } },
      { batchName: '12th_B', grid: { s1: { Mon: { type: 'class', mappingId: 'other' } } } },
    ],
    syllabusBatches: ['12th_A', '12th_B', '6M'],
    archivedBatches: [],
    studentProfiles: {
      'Aarav Nair':  { name: 'Aarav Nair',  lwsId: 'L1', batches: ['12th_A'], accountStatus: 'Active' },
      'Bhavya Rao':  { name: 'Bhavya Rao',  lwsId: 'L2', batches: ['12th_A'], accountStatus: 'Active' },
      'Chetan Joshi': { name: 'Chetan Joshi', lwsId: 'L3', batches: ['12th_A'], accountStatus: 'Active' },
    },
  })
}

vi.mock('../../../store/useStore', () => ({
  default: (selector) => selector(mockStore),
}))

import HomeworkPage from '../index'

function renderAs(mode, email) {
  return render(
    <ModeContext.Provider value={mode}>
      <HomeworkPage email={email} />
    </ModeContext.Provider>
  )
}

describe('HomeworkPage', () => {
  beforeEach(() => {
    resetStore()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('shows a teacher only the homework they set', () => {
    renderAs('teacher', 'asha@lws.com')
    expect(screen.getByText('Limits worksheet')).toBeInTheDocument()
    expect(screen.queryByText('Optics problems')).not.toBeInTheDocument()
  })

  it('shows an admin all homework', () => {
    renderAs('admin', 'office@lws.com')
    expect(screen.getByText('Limits worksheet')).toBeInTheDocument()
    expect(screen.getByText('Optics problems')).toBeInTheDocument()
  })

  it('shows how many have submitted out of the batch', async () => {
    renderAs('teacher', 'asha@lws.com')
    expect(await screen.findByText(/1 of 3 submitted/)).toBeInTheDocument()
  })

  describe('editor', () => {
    it('offers a teacher only their own subjects and batches', () => {
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /new homework/i }))
      const subject = screen.getByLabelText(/subject/i)
      expect([...subject.options].map(o => o.value).filter(Boolean)).toEqual(['Maths'])
      fireEvent.change(subject, { target: { value: 'Maths' } })
      expect(screen.getByRole('checkbox', { name: '12th_A' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: '6M' })).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: '12th_B' })).not.toBeInTheDocument()
    })

    it('tells a teacher with no timetabled classes why they cannot set homework', () => {
      renderAs('teacher', 'nobody@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /new homework/i }))
      expect(screen.getByText(/no classes in the timetable/i)).toBeInTheDocument()
    })

    it('keeps Publish disabled and says why until the homework is complete', () => {
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /new homework/i }))
      expect(screen.getByRole('button', { name: /^publish/i })).toBeDisabled()
      const needed = screen.getByRole('list', { name: /still needed before publishing/i })
      expect(within(needed).getByText(/upload the question paper/i)).toBeInTheDocument()
    })

    it('publishes with the picked files once complete', async () => {
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /new homework/i }))
      fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Derivatives set' } })
      fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Maths' } })
      fireEvent.click(screen.getByRole('checkbox', { name: '12th_A' }))
      fireEvent.change(screen.getByLabelText(/total marks/i), { target: { value: '10' } })
      fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: '2099-01-01T18:00' } })
      const paper = new File(['%PDF'], 'set.pdf', { type: 'application/pdf' })
      fireEvent.change(screen.getByLabelText(/question paper/i), { target: { files: [paper] } })

      const publish = screen.getByRole('button', { name: /^publish/i })
      expect(publish).toBeEnabled()
      fireEvent.click(publish)

      await waitFor(() => expect(mockStore.saveHomeworkAssignment).toHaveBeenCalled())
      const [draft, opts] = mockStore.saveHomeworkAssignment.mock.calls[0]
      expect(draft).toMatchObject({
        title: 'Derivatives set', subject: 'Maths', batchNames: ['12th_A'], maxMarks: 10,
        dueAt: '2099-01-01T12:30:00.000Z',
      })
      expect(opts.publish).toBe(true)
      expect(opts.questionFiles.map(f => f.name)).toEqual(['set.pdf'])
    })

    it('publishes a description-only homework with no file', async () => {
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /new homework/i }))
      fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Exercise 3.2' } })
      fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Maths' } })
      fireEvent.click(screen.getByRole('checkbox', { name: '12th_A' }))
      fireEvent.change(screen.getByLabelText(/total marks/i), { target: { value: '10' } })
      fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: '2099-01-01T18:00' } })
      fireEvent.change(screen.getByLabelText(/description/i), {
        target: { value: 'RD Sharma Exercise 3.2, Q1-10, as announced in class' },
      })
      // Without a paper, the grader has only the description: nudge for a key.
      expect(screen.getByText(/upload an answer key/i)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /^publish/i }))
      await waitFor(() => expect(mockStore.saveHomeworkAssignment).toHaveBeenCalled())
      const [draft, opts] = mockStore.saveHomeworkAssignment.mock.calls[0]
      expect(draft.instructions).toBe('RD Sharma Exercise 3.2, Q1-10, as announced in class')
      expect(opts.questionFiles).toEqual([])
    })

    it('refuses an unreadable file type at pick time', () => {
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /new homework/i }))
      const doc = new File(['x'], 'set.docx', { type: 'application/msword' })
      fireEvent.change(screen.getByLabelText(/question paper/i), { target: { files: [doc] } })
      expect(screen.getByText(/JPG, PNG, WEBP or PDF/)).toBeInTheDocument()
    })
  })

  describe('submissions', () => {
    it('lists who has submitted, with marks, and who has not', async () => {
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /submissions/i }))
      const graded = await screen.findByText('Aarav Nair')
      const row = graded.closest('[data-testid="roster-row"]')
      expect(within(row).getByText('7.5 / 10')).toBeInTheDocument()
      expect(screen.getByText('Bhavya Rao').closest('[data-testid="roster-row"]')).toHaveTextContent(/not submitted/i)
      expect(screen.getByText('Chetan Joshi')).toBeInTheDocument()
    })

    it('shows the per-question grade for a graded submission', async () => {
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /submissions/i }))
      fireEvent.click(await screen.findByRole('button', { name: /view aarav nair/i }))
      expect(await screen.findByText('Method right')).toBeInTheDocument()
      expect(screen.getByText('Final answer')).toBeInTheDocument()
      expect(screen.getByText('Clear working')).toBeInTheDocument()
    })
  })

  // 2026-10-13: a grade whose handwriting does not match the student's
  // reference is held until the homework's teacher or an admin decides.
  describe('held for a handwriting check', () => {
    const held = {
      id: 's2', assignmentId: 'a1', lwsId: 'L2', studentName: 'Bhavya Rao', status: 'held', files: ['a1/L2/s2/01.jpg'],
      totalAwarded: 9, totalMax: 10, wentWell: 'Neat', nextSteps: 'Units', handCheck: 'mismatch',
      handNote: 'Letter shapes differ from the reference throughout.', handReferenceId: 'r1',
      grades: [{ position: 1, label: 'Q1', maxMarks: 10, outcome: 'scored', awarded: 9, earned: 'Right', missing: 'Units' }],
    }
    beforeEach(() => {
      mockStore.getHomeworkSubmissions = vi.fn(async () => [held])
    })

    async function openHeld() {
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /submissions/i }))
      const row = (await screen.findByText('Bhavya Rao')).closest('[data-testid="roster-row"]')
      expect(row).toHaveTextContent(/held: handwriting/i)
      fireEvent.click(within(row).getByRole('button', { name: /view bhavya rao/i }))
      return row
    }

    it('shows the note, the marks, and the reference pages to compare', async () => {
      const row = await openHeld()
      expect(await within(row).findByText(/letter shapes differ/i)).toBeInTheDocument()
      expect(within(row).getByText(/student has not seen/i)).toBeInTheDocument()
      expect(within(row).getAllByText('9 / 10').length).toBeGreaterThan(0)
      expect(await within(row).findByRole('button', { name: /reference page 2/i })).toBeInTheDocument()
      expect(mockStore.getHomeworkReferenceFiles).toHaveBeenCalledWith('L2')
    })

    it('releases the grade and reloads', async () => {
      const row = await openHeld()
      fireEvent.click(await within(row).findByRole('button', { name: /release grade/i }))
      await waitFor(() => expect(mockStore.resolveHeldHomework).toHaveBeenCalledWith('s2', 'release', undefined))
      await waitFor(() => expect(mockStore.getHomeworkSubmissions).toHaveBeenCalledTimes(2))
    })

    it('sends it back only with a reason the student can act on', async () => {
      const row = await openHeld()
      fireEvent.click(await within(row).findByRole('button', { name: /^send back/i }))
      const reason = within(row).getByLabelText(/reason for the student/i)
      const confirm = within(row).getByRole('button', { name: /confirm send back/i })
      fireEvent.change(reason, { target: { value: 'Redo' } })
      expect(confirm).toBeDisabled()
      fireEvent.change(reason, { target: { value: 'Please redo this homework in your own handwriting.' } })
      fireEvent.click(confirm)
      await waitFor(() => expect(mockStore.resolveHeldHomework).toHaveBeenCalledWith(
        's2', 'reject', 'Please redo this homework in your own handwriting.',
      ))
    })

    it('says so when the release fails, and keeps the buttons', async () => {
      mockStore.resolveHeldHomework = vi.fn(async () => ({ ok: false, error: 'This homework was set by another teacher.' }))
      const row = await openHeld()
      fireEvent.click(await within(row).findByRole('button', { name: /release grade/i }))
      expect(await within(row).findByText(/set by another teacher/i)).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /release grade/i })).toBeInTheDocument()
    })

    it('flags an unclear check on a released grade without holding it', async () => {
      mockStore.getHomeworkSubmissions = vi.fn(async () => [{ ...held, status: 'graded', handCheck: 'unclear', handNote: 'Photo too blurry to compare.' }])
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /submissions/i }))
      const row = (await screen.findByText('Bhavya Rao')).closest('[data-testid="roster-row"]')
      expect(row).toHaveTextContent(/graded/i)
      expect(row).toHaveTextContent(/handwriting unclear/i)
      expect(within(row).queryByRole('button', { name: /release grade/i })).toBeNull()
    })

    it('counts a held submission as handed in on the homework list', async () => {
      mockStore.getHomeworkSubmissionStatuses = vi.fn(async () => [
        { assignmentId: 'a1', lwsId: 'L1', status: 'graded' },
        { assignmentId: 'a1', lwsId: 'L2', status: 'held' },
      ])
      renderAs('teacher', 'asha@lws.com')
      expect(await screen.findByText(/2 of 3 submitted/i)).toBeInTheDocument()
      expect(screen.getByText(/1 held for a handwriting check/i)).toBeInTheDocument()
    })
  })
})
