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
      layouts={[{ perPage: 1, sheets: [{}] }]}
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

// The scanner is handed every format the paper could have been printed in, and
// passes the set straight through: deciding which one it is belongs to the
// reader, which has the detected grid in front of it. Reading each candidate
// end to end instead would halve the frame rate for an answer the first fit
// already contains.
it('passes every candidate format through to the reader', async () => {
  const layouts = [{ perPage: 1, sheets: [{}] }, { perPage: 2, sheets: [{}] }]
  const { readFrame } = setup({ layouts })
  await startCamera()
  await waitFor(() => expect(readFrame).toHaveBeenCalled())
  expect(readFrame.mock.calls[0][1].layouts).toBe(layouts)
})

// The viewfinder on a phone.
//
// Measured in a real browser at 390x844: the video sat at y=742 in a window
// whose last 60px are the fixed bottom nav, so 42px of a 243px picture were on
// screen and the status line — the only thing that says whether a sheet was
// read — was 209px below the fold. On a 360x640 Android even the start button
// was below the fold. So while the camera runs the scanner lifts out of the
// page flow into a full-screen layer BELOW the md breakpoint. Desktop measured
// fine and is left exactly as it was, which is why this is a CSS breakpoint and
// not a matchMedia branch: same DOM at every width, nothing new to keep in sync.
//
// jsdom has no layout, so what is pinned here is what jsdom can see — that the
// classes switch, that the controls travel with the picture, and above all the
// two invariants this restructure could quietly break. The geometry itself is
// verified in a browser.
describe('SheetScanner · the viewfinder on a phone', () => {
  const root = container => container.firstChild

  it('sits in the page flow until the camera runs', () => {
    const { container } = setup()
    expect(root(container).className).not.toMatch(/fixed/)
  })

  it('lifts out of the page flow while the camera runs', async () => {
    const { container } = setup()
    await startCamera()
    await waitFor(() => expect(root(container).className).toMatch(/max-md:fixed/))
    expect(root(container).className).toMatch(/max-md:inset-0/)
  })

  it('hands the page back when the camera stops', async () => {
    const { container } = setup()
    await startCamera()
    await waitFor(() => expect(root(container).className).toMatch(/max-md:fixed/))
    await userEvent.click(screen.getByRole('button', { name: /stop camera/i }))
    expect(root(container).className).not.toMatch(/fixed/)
  })

  // A Stop button or a status line left behind in the page flow would be under
  // the layer, unreachable and unreadable with a stack of paper in hand.
  it('keeps the controls and the status with the picture', async () => {
    const { container } = setup()
    await startCamera()
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(root(container)).toContainElement(screen.getByRole('button', { name: /stop camera/i }))
    expect(root(container)).toContainElement(screen.getByRole('status'))
    expect(root(container)).toContainElement(container.querySelector('video'))
  })

  it('brings the keep-this-sheet offer along too', async () => {
    const { container } = setup({
      readFrame: vi.fn(() => okResult({ complete: false, reviewCount: 2 })),
    })
    await startCamera()
    const keep = await screen.findByRole('button', { name: /keep this sheet/i })
    expect(root(container)).toContainElement(keep)
  })

  // start() assigns the stream to videoRef.current. Were the layer a
  // conditionally-rendered subtree, the video would mount AFTER that assignment
  // and the operator would get a black rectangle — the camera running, the
  // frames unread, nothing thrown. The node has to survive the switch.
  it('never remounts the video, so the stream it was handed survives', async () => {
    const { container } = setup()
    const before = container.querySelector('video')
    expect(before).toBeTruthy()
    await startCamera()
    await waitFor(() => expect(screen.getByRole('button', { name: /stop camera/i })).toBeInTheDocument())
    expect(container.querySelector('video')).toBe(before)
  })

  // drawOverlay maps the read frame onto the video with one ratio per axis,
  // which is only correct while the element's box matches the stream's aspect —
  // measured at 324x243 against a 1920x1440 stream, exactly 1.333 both ways.
  // Centring the picture in a tall layer must therefore grow a wrapper AROUND
  // the outline box, never the outline box itself; stretched to fill the layer
  // it would draw the green "sheet found" outline well off the paper.
  it('centres the picture without stretching the box the outline is drawn in', async () => {
    const { container } = setup()
    await startCamera()
    const video = container.querySelector('video')
    const box = video.parentElement
    const overlay = box.querySelector('canvas')
    expect(overlay).toBeTruthy()
    expect(box.className).toMatch(/relative/)
    // A wrapper of its own between the box and the layer: that is what takes
    // the centring, so the box stays tight around the video.
    expect(box.parentElement).not.toBe(root(container))
  })
})
