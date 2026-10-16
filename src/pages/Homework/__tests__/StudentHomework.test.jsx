import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const uploadToSignedUrl = vi.fn(async () => ({ error: null }))
vi.mock('../../../lib/supabase', () => ({
  supabase: { storage: { from: vi.fn(() => ({ uploadToSignedUrl })) } },
}))

import StudentHomework from '../StudentHomework'

const DAY = 864e5
const later = new Date(Date.now() + 2 * DAY).toISOString()
const earlier = new Date(Date.now() - DAY).toISOString()

const HOMEWORK = [
  { id: 'open1', title: 'Limits — Exercise 2.3', subject: 'Maths', instructions: 'Show all working.', dueAt: later,
    maxMarks: 20, state: 'open', canSubmit: true, submission: null,
    questionFiles: [{ name: 'limits.pdf', type: 'application/pdf', url: 'https://signed/q1' }] },
  { id: 'desc1', title: 'RD Sharma Ex 3.2', subject: 'Maths', instructions: 'Exercise 3.2, Q1–10, as announced in class.',
    dueAt: later, maxMarks: 10, state: 'open', canSubmit: true, questionFiles: [],
    submission: { id: 's0', status: 'rejected', pages: 1, rejectedReason: 'Photos too blurry — please retake.', grades: [] } },
  { id: 'wait1', title: 'Trig identities', subject: 'Maths', instructions: '', dueAt: later, maxMarks: 10,
    state: 'open', canSubmit: false, canReplace: true, replacementsLeft: 2, questionFiles: [],
    submission: { id: 's1', status: 'submitted', pages: 3, submittedAt: earlier, grades: [] } },
  { id: 'graded1', title: 'Matrices', subject: 'Maths', instructions: '', dueAt: earlier, maxMarks: 10,
    state: 'closed', canSubmit: false, questionFiles: [],
    submission: { id: 's2', status: 'graded', pages: 2, totalAwarded: 7.5, totalMax: 10,
      wentWell: 'Neat row operations.', nextSteps: 'Check the determinant sign.', grades: [
        { position: 1, label: 'Q1', maxMarks: 5, outcome: 'scored', awarded: 5, earned: 'Correct inverse.', missing: null },
        { position: 2, label: 'Q2', maxMarks: 5, outcome: 'scored', awarded: 2.5, earned: 'Right method.', missing: 'Sign error.' },
      ] } },
  { id: 'missed1', title: 'Vectors', subject: 'Maths', instructions: '', dueAt: earlier, maxMarks: 10,
    state: 'closed', canSubmit: false, questionFiles: [], submission: null },
]

function mockFetch(handlers = {}) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    const h = handlers[body.kind]
    const r = h ? h(body) : body.kind === 'homework-list' ? { status: 200, json: { name: 'Arjun', homework: HOMEWORK } } : { status: 500, json: {} }
    return { ok: r.status === 200, status: r.status, json: async () => r.json }
  }))
  return calls
}

const card = title => screen.getByText(title).closest('[data-testid="homework-card"]')

describe('StudentHomework', () => {
  beforeEach(() => { uploadToSignedUrl.mockClear(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => vi.unstubAllGlobals())

  it('lists homework with its description, deadline and question paper', async () => {
    mockFetch()
    render(<StudentHomework mobile="9876543210" lwsId="L1" />)
    const c = await waitFor(() => card('Limits — Exercise 2.3'))
    expect(within(c).getByText('Show all working.')).toBeInTheDocument()
    expect(within(c).getByRole('link', { name: /limits\.pdf/ })).toHaveAttribute('href', 'https://signed/q1')
    expect(within(c).getByText(/due/i)).toBeInTheDocument()
  })

  it('sends the student\'s mobile and ID', async () => {
    const calls = mockFetch()
    render(<StudentHomework mobile="9876543210" lwsId="L1" />)
    await screen.findByText('Matrices')
    expect(calls[0]).toEqual({ kind: 'homework-list', mobile: '9876543210', lwsId: 'L1' })
  })

  it('shows a description-only homework with no paper link', async () => {
    mockFetch()
    render(<StudentHomework mobile="9876543210" lwsId="L1" />)
    const c = await waitFor(() => card('RD Sharma Ex 3.2'))
    expect(within(c).getByText(/as announced in class/)).toBeInTheDocument()
    expect(within(c).queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows marks, feedback and each question for graded work', async () => {
    mockFetch()
    render(<StudentHomework mobile="9876543210" lwsId="L1" />)
    const c = await waitFor(() => card('Matrices'))
    expect(within(c).getByText('7.5 / 10')).toBeInTheDocument()
    fireEvent.click(within(c).getByRole('button', { name: /see marks/i }))
    expect(within(c).getByText('Neat row operations.')).toBeInTheDocument()
    expect(within(c).getByText('Sign error.')).toBeInTheDocument()
  })

  // 2026-10-16: the marked-paper report behind "See marks".
  describe('the marked paper report', () => {
    const graded = (sub = {}) => ({
      id: 'r1', title: 'Pair of lines', subject: 'Maths', instructions: '', dueAt: earlier, maxMarks: 15,
      state: 'closed', canSubmit: false, canReplace: false, replacementsLeft: 0, questionFiles: [],
      submission: {
        id: 'sr', status: 'graded', pages: 2, totalAwarded: 10, totalMax: 15,
        wentWell: 'Clear setup.', nextSteps: 'State the condition.',
        markedPages: ['https://signed/p1', 'https://signed/p2'], reportUrl: 'https://signed/report', pagesRemoved: false,
        grades: [
          { position: 1, label: 'Q1', maxMarks: 5, outcome: 'scored', awarded: 3.5, earned: 'Method.', missing: 'No final value.', cause: 'incomplete', topic: 'State the final value' },
          { position: 2, label: 'Q2', maxMarks: 5, outcome: 'scored', awarded: 2, earned: 'Setup.', missing: 'Wrong condition.', cause: 'concept', topic: 'Condition for perpendicular lines' },
          { position: 3, label: 'Q3', maxMarks: 5, outcome: 'scored', awarded: 4.5, earned: 'Right.', missing: 'Sign slip.', cause: 'careless', topic: null },
        ],
        ...sub,
      },
    })
    const open = async hw => {
      mockFetch({ 'homework-list': () => ({ status: 200, json: { name: 'A', homework: [hw] } }) })
      render(<StudentHomework mobile="9876543210" lwsId="L1" />)
      const c = await waitFor(() => card('Pair of lines'))
      fireEvent.click(within(c).getByRole('button', { name: /see marks/i }))
      return c
    }

    it('shows where the marks went, by cause, with the marks and questions as text', async () => {
      const c = await open(graded())
      const where = within(c).getByRole('list', { name: /where your marks went/i })
      expect(within(where).getAllByRole('listitem').map(li => li.textContent)).toEqual([
        expect.stringMatching(/Concept gaps.*−3.*Q2/),
        expect.stringMatching(/Steps left out.*−1\.5.*Q1/),
        expect.stringMatching(/Slips.*−0\.5.*Q3/),
      ])
    })

    it('says what fixing the slips is worth', async () => {
      const c = await open(graded())
      expect(within(c).getByText(/fix the slips in Q3/i)).toHaveTextContent('10.5 / 15')
    })

    it('lists what to focus on, biggest loss first', async () => {
      const c = await open(graded())
      const focus = within(c).getByRole('list', { name: /what to focus on/i })
      expect(within(focus).getAllByRole('listitem').map(li => li.textContent)).toEqual([
        expect.stringMatching(/Learn this again: Condition for perpendicular lines.*Wrong condition\./),
        expect.stringMatching(/Show full steps: State the final value.*No final value\./),
      ])
    })

    it('shows the marked pages, each opening full size, and the PDF download', async () => {
      const c = await open(graded())
      const pages = within(c).getAllByRole('img', { name: /marked page/i })
      expect(pages.map(p => [p.getAttribute('src'), p.getAttribute('alt')])).toEqual([
        ['https://signed/p1', 'Marked page 1 of 2'], ['https://signed/p2', 'Marked page 2 of 2'],
      ])
      expect(pages[0].closest('a')).toHaveAttribute('href', 'https://signed/p1')
      expect(within(c).getByRole('link', { name: /download marked paper/i })).toHaveAttribute('href', 'https://signed/report')
    })

    it('says the pages were removed after 30 days, and offers no download', async () => {
      const c = await open(graded({ markedPages: [], reportUrl: null, pagesRemoved: true }))
      expect(within(c).getByText(/removed 30 days after grading/i)).toBeInTheDocument()
      expect(within(c).queryByRole('link', { name: /download marked paper/i })).toBeNull()
      expect(within(c).queryAllByRole('img', { name: /marked page/i })).toEqual([])
    })

    it('shows an older grade without pages or causes as before, with no empty sections', async () => {
      const c = await open(graded({
        markedPages: [], reportUrl: null, pagesRemoved: false,
        grades: [{ position: 1, label: 'Q1', maxMarks: 15, outcome: 'scored', awarded: 10, earned: 'e', missing: 'Sign error.', cause: null, topic: null }],
      }))
      expect(within(c).getByText('Sign error.')).toBeInTheDocument()
      expect(within(c).queryByRole('list', { name: /what to focus on/i })).toBeNull()
      expect(within(c).queryByText(/removed 30 days/i)).toBeNull()
      expect(within(c).queryByRole('link', { name: /download marked paper/i })).toBeNull()
    })
  })

  it('says when work is waiting to be graded, and when it was missed', async () => {
    mockFetch()
    render(<StudentHomework mobile="9876543210" lwsId="L1" />)
    expect(within(await waitFor(() => card('Trig identities'))).getByText(/waiting to be graded/i)).toBeInTheDocument()
    expect(within(card('Vectors')).getByText(/not submitted/i)).toBeInTheDocument()
  })

  it('shows why work was sent back and lets the student hand it in again', async () => {
    mockFetch()
    render(<StudentHomework mobile="9876543210" lwsId="L1" />)
    const c = await waitFor(() => card('RD Sharma Ex 3.2'))
    expect(within(c).getByText(/too blurry/)).toBeInTheDocument()
    expect(within(c).getByLabelText(/choose photos or pdf/i)).toBeInTheDocument()
  })

  it('hands in the picked pages: start, upload each, submit, then reload', async () => {
    const calls = mockFetch({
      'homework-start': () => ({ status: 200, json: { submissionId: 'new', uploads: [
        { path: 'open1/L1/new/01.jpg', token: 't1' }, { path: 'open1/L1/new/02.pdf', token: 't2' }] } }),
      'homework-submit': () => ({ status: 200, json: { ok: true } }),
    })
    render(<StudentHomework mobile="9876543210" lwsId="L1" />)
    const c = await waitFor(() => card('Limits — Exercise 2.3'))
    const pages = [new File(['a'], 'p1.jpg', { type: 'image/jpeg' }), new File(['%PDF'], 'p2.pdf', { type: 'application/pdf' })]
    fireEvent.change(within(c).getByLabelText(/choose photos or pdf/i), { target: { files: pages } })
    expect(await within(c).findByText('p1.jpg')).toBeInTheDocument()

    fireEvent.click(within(c).getByRole('button', { name: /submit all 2 pages \(final\)/i }))
    await waitFor(() => expect(calls.map(b => b.kind)).toEqual(['homework-list', 'homework-start', 'homework-submit', 'homework-list']))
    expect(uploadToSignedUrl.mock.calls.map(c2 => [c2[0], c2[1], c2[2].name])).toEqual([
      ['open1/L1/new/01.jpg', 't1', 'p1.jpg'], ['open1/L1/new/02.pdf', 't2', 'p2.pdf'],
    ])
  })

  it('refuses a file type it cannot accept at pick time', async () => {
    mockFetch()
    render(<StudentHomework mobile="9876543210" lwsId="L1" />)
    const c = await waitFor(() => card('Limits — Exercise 2.3'))
    fireEvent.change(within(c).getByLabelText(/choose photos or pdf/i), {
      target: { files: [new File(['x'], 'a.heic', { type: 'image/heic' })] },
    })
    expect(within(c).getByText(/JPG, PNG, WEBP or PDF/)).toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: /submit/i })).not.toBeInTheDocument()
  })

  it('shows the server\'s reason when handing in fails', async () => {
    mockFetch({ 'homework-start': () => ({ status: 409, json: { error: 'The deadline for this homework has passed.' } }) })
    render(<StudentHomework mobile="9876543210" lwsId="L1" />)
    const c = await waitFor(() => card('Limits — Exercise 2.3'))
    fireEvent.change(within(c).getByLabelText(/choose photos or pdf/i), { target: { files: [new File(['%PDF'], 'p1.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(await within(c).findByRole('button', { name: /submit 1 page \(final\)/i }))
    expect(await within(c).findByText('The deadline for this homework has passed.')).toBeInTheDocument()
  })

  // 2026-10-14: a hand-in waiting to be graded can be replaced before the
  // deadline; once marked it is final.
  describe('replacing a hand-in that has not been marked', () => {
    const photo = name => new File(['a'], name, { type: 'image/jpeg' })
    const okHandlers = () => ({
      'homework-start': b => ({ status: 200, json: { submissionId: 'r', uploads: b.files.map((_, i) => ({ path: `wait1/L1/r/0${i + 1}.jpg`, token: `t${i}` })) } }),
      'homework-submit': () => ({ status: 200, json: { ok: true } }),
    })
    afterEach(() => vi.restoreAllMocks())

    it('offers Replace on a waiting hand-in and not on a marked one', async () => {
      mockFetch()
      render(<StudentHomework mobile="9876543210" lwsId="L1" />)
      const c = await waitFor(() => card('Trig identities'))
      expect(within(c).queryByLabelText(/choose photos or pdf/i)).not.toBeInTheDocument()
      fireEvent.click(within(c).getByRole('button', { name: /replace my submission/i }))
      expect(within(c).getByLabelText(/choose photos or pdf/i)).toBeInTheDocument()
      expect(within(c).getByText(/replaces everything you sent before/i)).toBeInTheDocument()
      expect(within(c).getByText(/this is replacement 1 of 2/i)).toBeInTheDocument()
      expect(within(card('Matrices')).queryByRole('button', { name: /replace/i })).not.toBeInTheDocument()
    })

    it('replaces after the student confirms, asking the server to replace', async () => {
      const calls = mockFetch(okHandlers())
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<StudentHomework mobile="9876543210" lwsId="L1" />)
      const c = await waitFor(() => card('Trig identities'))
      fireEvent.click(within(c).getByRole('button', { name: /replace my submission/i }))
      fireEvent.change(within(c).getByLabelText(/choose photos or pdf/i), { target: { files: [photo('n1.jpg'), photo('n2.jpg')] } })
      fireEvent.click(await within(c).findByRole('button', { name: /submit all 2 pages/i }))
      expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/replaces the 3 pages you sent earlier/i))
      await waitFor(() => expect(calls.map(b => b.kind)).toEqual(['homework-list', 'homework-start', 'homework-submit', 'homework-list']))
      expect(calls[1]).toMatchObject({ assignmentId: 'wait1', replace: true })
    })

    it('sends nothing when the student says no, and Cancel closes the panel', async () => {
      const calls = mockFetch(okHandlers())
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<StudentHomework mobile="9876543210" lwsId="L1" />)
      const c = await waitFor(() => card('Trig identities'))
      fireEvent.click(within(c).getByRole('button', { name: /replace my submission/i }))
      fireEvent.change(within(c).getByLabelText(/choose photos or pdf/i), { target: { files: [photo('n1.jpg'), photo('n2.jpg')] } })
      fireEvent.click(await within(c).findByRole('button', { name: /submit all 2 pages/i }))
      expect(calls.map(b => b.kind)).toEqual(['homework-list'])
      fireEvent.click(within(c).getByRole('button', { name: /cancel/i }))
      expect(within(c).queryByLabelText(/choose photos or pdf/i)).not.toBeInTheDocument()
    })
  })

  // 2026-10-13: students read "Submit 1 page" as "upload this page" and handed
  // in one photo of five, then could not add the rest.
  describe('handing in is final, and the screen says so', () => {
    const photo = name => new File(['a'], name, { type: 'image/jpeg' })
    const okHandlers = () => ({
      'homework-start': b => ({ status: 200, json: { submissionId: 'new', uploads: b.files.map((_, i) => ({ path: `open1/L1/new/0${i + 1}.jpg`, token: `t${i}` })) } }),
      'homework-submit': () => ({ status: 200, json: { ok: true } }),
    })
    afterEach(() => vi.restoreAllMocks())

    it('turns the camera button into "Take photo page N" once a page is in', async () => {
      mockFetch()
      render(<StudentHomework mobile="9876543210" lwsId="L1" />)
      const c = await waitFor(() => card('Limits — Exercise 2.3'))
      expect(within(c).getByLabelText(/take a photo/i)).toBeInTheDocument()
      fireEvent.change(within(c).getByLabelText(/take a photo/i), { target: { files: [photo('p1.jpg')] } })
      expect(await within(c).findByLabelText(/take photo page 2/i)).toBeInTheDocument()
      expect(within(c).getByText(/submit your work/i)).toBeInTheDocument()
      expect(within(c).getByText(/can.t add a page afterwards/i)).toBeInTheDocument()
      fireEvent.change(within(c).getByLabelText(/take photo page 2/i), { target: { files: [photo('p2.jpg')] } })
      expect(await within(c).findByLabelText(/take photo page 3/i)).toBeInTheDocument()
    })

    it('asks before handing in a single photo, and a "no" sends nothing', async () => {
      const calls = mockFetch(okHandlers())
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<StudentHomework mobile="9876543210" lwsId="L1" />)
      const c = await waitFor(() => card('Limits — Exercise 2.3'))
      fireEvent.change(within(c).getByLabelText(/take a photo/i), { target: { files: [photo('p1.jpg')] } })
      fireEvent.click(await within(c).findByRole('button', { name: /submit 1 page \(final\)/i }))
      expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/only 1 page.*can.t add more.*submit it\?/is))
      expect(calls.map(b => b.kind)).toEqual(['homework-list'])
      expect(within(c).getByText('p1.jpg')).toBeInTheDocument()
    })

    it('hands in a single photo once the student confirms', async () => {
      const calls = mockFetch(okHandlers())
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<StudentHomework mobile="9876543210" lwsId="L1" />)
      const c = await waitFor(() => card('Limits — Exercise 2.3'))
      fireEvent.change(within(c).getByLabelText(/take a photo/i), { target: { files: [photo('p1.jpg')] } })
      fireEvent.click(await within(c).findByRole('button', { name: /submit 1 page/i }))
      await waitFor(() => expect(calls.map(b => b.kind)).toContain('homework-submit'))
    })

    it('does not ask for several pages or a single PDF', async () => {
      mockFetch(okHandlers())
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<StudentHomework mobile="9876543210" lwsId="L1" />)
      const c = await waitFor(() => card('Limits — Exercise 2.3'))
      fireEvent.change(within(c).getByLabelText(/choose photos or pdf/i), { target: { files: [photo('p1.jpg'), photo('p2.jpg')] } })
      fireEvent.click(await within(c).findByRole('button', { name: /submit all 2 pages/i }))
      await waitFor(() => expect(uploadToSignedUrl).toHaveBeenCalledTimes(2))
      expect(confirm).not.toHaveBeenCalled()
    })

    it("uploads the copy read at pick time, not the phone's file link", async () => {
      mockFetch(okHandlers())
      render(<StudentHomework mobile="9876543210" lwsId="L1" />)
      const c = await waitFor(() => card('Limits — Exercise 2.3'))
      const picked = [photo('p1.jpg'), photo('p2.jpg')]
      fireEvent.change(within(c).getByLabelText(/choose photos or pdf/i), { target: { files: picked } })
      await within(c).findByText('p2.jpg')
      // The phone's link goes stale after picking; the upload must not need it.
      picked.forEach(f => { f.arrayBuffer = () => Promise.reject(new Error('gone')) })
      fireEvent.click(await within(c).findByRole('button', { name: /submit all 2 pages/i }))
      await waitFor(() => expect(uploadToSignedUrl).toHaveBeenCalledTimes(2))
      expect(uploadToSignedUrl.mock.calls[0][2]).not.toBe(picked[0])
      expect(await uploadToSignedUrl.mock.calls[0][2].text()).toBe('a')
    })

    it('refuses a photo the phone cannot read the moment it is picked', async () => {
      mockFetch()
      render(<StudentHomework mobile="9876543210" lwsId="L1" />)
      const c = await waitFor(() => card('Limits — Exercise 2.3'))
      const bad = photo('IMG_7.jpg')
      bad.arrayBuffer = () => Promise.reject(new Error('NotReadableError'))
      fireEvent.change(within(c).getByLabelText(/take a photo/i), { target: { files: [bad] } })
      expect(await within(c).findByText(/IMG_7\.jpg.*again/i)).toBeInTheDocument()
      expect(within(c).queryByText('Page 1')).not.toBeInTheDocument()
      expect(within(c).queryByRole('button', { name: /hand in|submit/i })).not.toBeInTheDocument()
    })
  })

  it('renders nothing when there is no homework', async () => {
    mockFetch({ 'homework-list': () => ({ status: 200, json: { name: 'Arjun', homework: [] } }) })
    const { container } = render(<StudentHomework mobile="9876543210" lwsId="L1" />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
