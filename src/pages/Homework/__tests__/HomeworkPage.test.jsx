import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModeContext } from '../../../context/ModeContext'

const LATER = new Date(Date.now() + 3 * 864e5).toISOString()

// The live site is IS_READ_ONLY; a test flips it to render as there.
const cfg = vi.hoisted(() => ({ readOnly: false }))
vi.mock('../../../config', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, get IS_READ_ONLY() { return cfg.readOnly } }
})

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

    it('starts each added question at 5 marks, which the teacher can change', () => {
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /new homework/i }))
      fireEvent.click(screen.getByRole('button', { name: /add question/i }))
      fireEvent.click(screen.getByRole('button', { name: /add question/i }))
      expect(screen.getByLabelText('Question 1 marks')).toHaveValue(5)
      expect(screen.getByLabelText('Question 2 marks')).toHaveValue(5)
      fireEvent.change(screen.getByLabelText('Question 2 marks'), { target: { value: '3' } })
      expect(screen.getByLabelText('Question 2 marks')).toHaveValue(3)
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

    // 2026-10-16: the cause of each loss, and the report the student gets. The
    // marked pages are inside the report, so they get no buttons of their own.
    it('shows why marks were lost and opens the report, with no marked-page buttons', async () => {
      mockStore.getHomeworkSubmissions = vi.fn(async () => [{
        id: 's1', assignmentId: 'a1', lwsId: 'L1', studentName: 'Aarav Nair', status: 'graded', files: ['a1/L1/s1/01.jpg'],
        totalAwarded: 7.5, totalMax: 10, wentWell: 'Clear working', nextSteps: 'Revise', scansDeletedAt: null,
        markedPages: ['a1/L1/s1/marked/01.jpg', 'a1/L1/s1/marked/02.jpg'], reportPath: 'a1/L1/s1/marked/report.pdf',
        grades: [{ position: 1, label: 'Q1', maxMarks: 10, outcome: 'scored', awarded: 7.5, earned: 'Method right', missing: 'Final answer', cause: 'concept', topic: 'Chain rule' }],
      }])
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /submissions/i }))
      fireEvent.click(await screen.findByRole('button', { name: /view aarav nair/i }))
      expect(await screen.findByText(/Concept gap: Chain rule/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /marked page/i })).not.toBeInTheDocument()
      const report = screen.getByRole('button', { name: /report \(pdf\)/i })
      expect(report).toHaveClass('btn-primary')
      fireEvent.click(report)
      await waitFor(() => expect(mockStore.getHomeworkFileUrl).toHaveBeenCalledWith('homework-submissions', 'a1/L1/s1/marked/report.pdf'))
    })
  })

  // 2026-10-16: an admin emails the marked-paper report, from the live site
  // (it began local-only, where the page could not load). Teachers never send.
  describe('emailing the marked paper', () => {
    const marked = (over = {}) => ({
      id: 's1', assignmentId: 'a1', lwsId: 'L1', studentName: 'Aarav Nair', status: 'graded', files: ['a1/L1/s1/01.jpg'],
      totalAwarded: 7.5, totalMax: 10, wentWell: 'Clear working', nextSteps: 'Revise', scansDeletedAt: null,
      markedPages: ['a1/L1/s1/marked/01.jpg'], reportPath: 'a1/L1/s1/marked/report.pdf', reportEmailedAt: null,
      grades: [{ position: 1, label: 'Q1', maxMarks: 10, outcome: 'scored', awarded: 7.5, earned: 'Method right', missing: 'Final answer', cause: 'careless', topic: null }],
      ...over,
    })
    const openAsAdmin = async () => {
      renderAs('admin', 'office@lws.com')
      fireEvent.click(screen.getAllByRole('button', { name: /submissions/i })[0])
      return screen.findByRole('button', { name: /email reports \(1 not sent\)/i })
    }
    beforeEach(() => {
      mockStore.getHomeworkSubmissions = vi.fn(async () => [
        marked(),
        marked({ id: 's2', lwsId: 'L2', studentName: 'Bhavya Rao', reportEmailedAt: '2026-10-16T08:00:00Z' }),
      ])
      mockStore.emailHomeworkReports = vi.fn(async ids => ({ ok: true, sent: ids.map(id => ({ id, name: 'Aarav Nair', to: 'a@x.co' })), skipped: [], failed: [], test: false }))
    })

    it('offers an admin to email the reports not yet sent, and a teacher nothing', async () => {
      expect(await openAsAdmin()).toBeEnabled()
    })

    it('works on the live site, with no "use the local app" message', async () => {
      cfg.readOnly = true
      try {
        expect(await openAsAdmin()).toBeEnabled()
        expect(screen.queryByText(/local admin app/i)).toBeNull()
        fireEvent.click(await screen.findByRole('button', { name: /view aarav nair/i }))
        expect(await screen.findByRole('button', { name: /^email report$/i })).toBeEnabled()
      } finally {
        cfg.readOnly = false
      }
    })

    it('shows a teacher no email button', async () => {
      renderAs('teacher', 'asha@lws.com')
      fireEvent.click(screen.getByRole('button', { name: /submissions/i }))
      await screen.findByText('Aarav Nair')
      expect(screen.queryByRole('button', { name: /email report/i })).toBeNull()
    })

    it('confirms who it goes to, then sends and reloads', async () => {
      fireEvent.click(await openAsAdmin())
      const panel = screen.getByRole('region', { name: /email marked papers/i })
      expect(within(panel).getByText('Aarav Nair')).toBeInTheDocument()
      expect(within(panel).queryByText('Bhavya Rao')).toBeNull()
      fireEvent.click(within(panel).getByRole('button', { name: /send to 1 student/i }))
      await waitFor(() => expect(mockStore.emailHomeworkReports).toHaveBeenCalledWith(['s1'], null))
      expect(await within(panel).findByText(/sent to 1/i)).toBeInTheDocument()
      await waitFor(() => expect(mockStore.getHomeworkSubmissions).toHaveBeenCalledTimes(2))
    })

    it('sends a test to a staff address without sending to the student', async () => {
      fireEvent.click(await openAsAdmin())
      const panel = screen.getByRole('region', { name: /email marked papers/i })
      const send = within(panel).getByRole('button', { name: /send a test/i })
      expect(send).toBeDisabled()
      fireEvent.change(within(panel).getByLabelText(/send a test to/i), { target: { value: 'office@lws.com' } })
      fireEvent.click(send)
      await waitFor(() => expect(mockStore.emailHomeworkReports).toHaveBeenCalledWith(['s1'], 'office@lws.com'))
    })

    it('lists what was skipped or failed, with the reason', async () => {
      mockStore.emailHomeworkReports = vi.fn(async () => ({
        ok: true, sent: [], test: false,
        skipped: [{ id: 's1', name: 'Aarav Nair', reason: 'no email address on file' }],
        failed: [{ id: 's9', name: 'Chetan Joshi', error: 'SMTPAuthenticationError: bad password' }],
      }))
      fireEvent.click(await openAsAdmin())
      const panel = screen.getByRole('region', { name: /email marked papers/i })
      fireEvent.click(within(panel).getByRole('button', { name: /send to 1 student/i }))
      expect(await within(panel).findByText(/Aarav Nair: no email address on file/)).toBeInTheDocument()
      expect(within(panel).getByText(/Chetan Joshi: SMTPAuthenticationError: bad password/)).toBeInTheDocument()
    })

    it('says when a report was emailed, and offers to resend it', async () => {
      await openAsAdmin()
      fireEvent.click(await screen.findByRole('button', { name: /view bhavya rao/i }))
      expect(await screen.findByText(/report emailed 16 Oct 2026/i)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /resend report/i }))
      const panel = screen.getByRole('region', { name: /email marked papers/i })
      expect(within(panel).getByText('Bhavya Rao')).toBeInTheDocument()
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
