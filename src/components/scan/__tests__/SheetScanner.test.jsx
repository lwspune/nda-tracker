import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import SheetScanner from '../SheetScanner'

// jsdom has no camera and no canvas pixels, so both are injected. What is under
// test is the wiring — that a confirmed read reaches onCapture exactly once, that
// a refusal is shown, and that the camera is released.
const okResult = (o = {}) => ({
  ok: true, complete: true, reviewCount: 0,
  answers: { 1: 'A' },
  corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  roll: { digits: '00013', review: false },
  student: { lwsId: 'LWS-013', review: false },
  ...o,
})

let stopSpy
function makeStream() {
  stopSpy = vi.fn()
  return { getTracks: () => [{ stop: stopSpy, getCapabilities: () => ({}), applyConstraints: vi.fn() }] }
}

const FRAME = { width: 20, height: 20, data: new Uint8ClampedArray(1600) }

function setup(props = {}) {
  const onCapture = vi.fn()
  const openCamera = vi.fn(async () => makeStream())
  const captureFrame = vi.fn(() => FRAME)
  const readFrame = props.readFrame || vi.fn(() => okResult())
  const utils = render(
    <SheetScanner
      layout={{ sheets: [{}] }}
      roster={[]}
      onCapture={onCapture}
      openCamera={openCamera}
      captureFrame={captureFrame}
      readFrame={readFrame}
      intervalMs={10}
      {...props}
    />,
  )
  return { ...utils, onCapture, openCamera, captureFrame, readFrame }
}

const startCamera = async () =>
  userEvent.click(screen.getByRole('button', { name: /scan with the camera/i }))

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('SheetScanner', () => {
  it('does not touch the camera until asked', () => {
    const { openCamera } = setup()
    expect(openCamera).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /scan with the camera/i })).toBeInTheDocument()
  })

  it('asks for the back camera, which is the one pointed at the paper', async () => {
    const { openCamera } = setup()
    await startCamera()
    await waitFor(() => expect(openCamera).toHaveBeenCalled())
  })

  it('files a sheet once two frames agree, and only once', async () => {
    const { onCapture } = setup()
    await startCamera()
    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1), { timeout: 2000 })
    const before = onCapture.mock.calls.length
    await act(async () => { await new Promise(r => setTimeout(r, 120)) })
    expect(onCapture.mock.calls.length).toBe(before)
    expect(onCapture.mock.calls[0][0].student.lwsId).toBe('LWS-013')
  })

  // The reader's own refusal is the coaching: it already says whether the sheet
  // is out of frame or is the wrong paper entirely.
  it('shows why a frame could not be read', async () => {
    setup({ readFrame: vi.fn(() => ({ ok: false, reason: 'Only 3 registration marks found' })) })
    await startCamera()
    await waitFor(() => expect(screen.getByText(/3 registration marks/i)).toBeInTheDocument())
  })

  // A flagged question is a decision, and nobody decides through a viewfinder
  // with both hands full of paper.
  it('does not file a sheet that still needs a human, but offers to keep it', async () => {
    const { onCapture } = setup({
      readFrame: vi.fn(() => okResult({ complete: false, reviewCount: 2 })),
    })
    await startCamera()
    await waitFor(() => expect(screen.getByText(/2 questions to check/i)).toBeInTheDocument())
    expect(onCapture).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /keep this sheet/i }))
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onCapture.mock.calls[0][0].complete).toBe(false)
  })

  it('says so plainly when the camera is refused', async () => {
    setup({ openCamera: vi.fn(async () => { throw new DOMException('no', 'NotAllowedError') }) })
    await startCamera()
    await waitFor(() => expect(screen.getByText(/permission|denied|allow/i)).toBeInTheDocument())
  })

  // A camera left running is a hot phone and a recording light, and on some
  // devices it blocks the next page that wants it.
  it('releases the camera when it is stopped', async () => {
    setup()
    await startCamera()
    await waitFor(() => expect(screen.getByRole('button', { name: /stop camera/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /stop camera/i }))
    expect(stopSpy).toHaveBeenCalled()
  })

  it('releases the camera when the page goes away', async () => {
    const { unmount } = setup()
    await startCamera()
    await waitFor(() => expect(stopSpy).toBeDefined())
    unmount()
    await waitFor(() => expect(stopSpy).toHaveBeenCalled())
  })
})
