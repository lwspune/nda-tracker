// The viewfinder: read sheets as the camera sees them, not after a photograph.
//
// Taking a picture and then waiting for a verdict makes every sheet a two-step
// job with a pause in the middle; reading the live frames makes it one motion —
// hold the sheet, hear the beep, move it away, next. That is the whole
// difference, and the reading was always fast enough for it. What this component
// owns is the camera, the frames, and the drawing. WHEN to commit a sheet is
// `liveCapture.js`, which is pure and tested without a camera.
//
// Everything the browser provides is injectable, because jsdom has neither a
// camera nor canvas pixels and a test that mocks the whole component proves
// nothing.

import { useCallback, useEffect, useRef, useState } from 'react'
import { readSheetImage } from '../../lib/omr/readSheetImage'
import { liveInitial, liveStep } from '../../lib/omr/liveCapture'

/** The back camera, at the highest sane resolution the device will give. */
async function defaultOpenCamera() {
  return navigator.mediaDevices.getUserMedia({
    video: {
      // `ideal`, not `exact`: a laptop has only a front camera and must still work.
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1440 },
    },
    audio: false,
  })
}

/**
 * One video frame as ImageData, downscaled.
 *
 * Evalbee reads its own sheets at about this size. A 12 MP frame buys no
 * accuracy — the detector works in fractions of the frame, not pixels — and
 * costs time on every single frame rather than once per photograph.
 */
function defaultCaptureFrame(video, canvas, maxEdge) {
  if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return null
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
  const width = Math.round(video.videoWidth * scale)
  const height = Math.round(video.videoHeight * scale)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width; canvas.height = height
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(video, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

/** Plain words for the reasons a camera says no. */
function cameraTrouble(err) {
  const name = err?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Allow it for this site, then try again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera found on this device — choose the sheet files instead.'
  }
  if (name === 'NotReadableError') {
    return 'The camera is already in use by another app.'
  }
  return `The camera could not be started (${name || 'unknown error'}).`
}

// While the camera runs, the scanner leaves the page flow on a phone.
//
// Measured in a browser at 390x844: inline, the picture began at y=742 with the
// fixed bottom nav covering everything past 784 — 42px of a 243px viewfinder on
// screen, and the status line, the only thing that says whether a sheet was
// read, 209px below the fold. On a 360x640 Android even the start button was
// below the fold.
//
// A `max-md:` breakpoint rather than a matchMedia branch: the DOM is then
// identical at every width, so the desktop layout — which measured fine — is the
// same nodes in the same order, and there is no second arrangement to keep in
// step with this one.
//
// Surface-coloured rather than black, which is the usual scanner backdrop. The
// picture is letterboxed in a tall phone whatever sits behind it, and every text
// tone in this component is a dark-on-light token; a black layer would need a
// second palette for the status line and the "N read" count, and would fail
// contrast the first time somebody added a tone and forgot.
const LAYER =
  'space-y-2 max-md:fixed max-md:inset-0 max-md:z-[60] max-md:bg-surface ' +
  'max-md:flex max-md:flex-col max-md:gap-3 max-md:space-y-0 max-md:px-3 ' +
  'max-md:pt-[max(0.75rem,env(safe-area-inset-top))] ' +
  'max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]'

const TONE = {
  hunting:   'text-ink-3',
  holding:   'text-amber-600',
  accepted:  'text-accent',
  done:      'text-ink-3',
  review:    'text-amber-600',
  duplicate: 'text-danger',
}

export default function SheetScanner({
  layouts,
  roster,
  onCapture,
  intervalMs = 90,
  maxEdge = 1100,
  openCamera = defaultOpenCamera,
  captureFrame = defaultCaptureFrame,
  readFrame = readSheetImage,
}) {
  const videoRef = useRef(null)
  const overlayRef = useRef(null)
  const workRef = useRef(null)
  const streamRef = useRef(null)
  const runningRef = useRef(false)
  // The accept-rule's state lives in a ref, not in React state: it is threaded
  // frame to frame by the loop, and re-rendering is not what advances it.
  const liveRef = useRef(liveInitial())

  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState({ phase: 'hunting', message: '' })
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(null)   // read, but needs a human
  const [count, setCount] = useState(0)
  const [torchOn, setTorchOn] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)

  const stop = useCallback(() => {
    runningRef.current = false
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setRunning(false)
    setTorchOn(false)
    setPending(null)
    setStatus({ phase: 'hunting', message: '' })
  }, [])

  // A camera left running is a hot phone and a live recording light, and on some
  // devices it holds the device against whatever wants it next.
  useEffect(() => stop, [stop])

  function drawOverlay(result) {
    const canvas = overlayRef.current
    const video = videoRef.current
    if (!canvas || !video || !canvas.getContext) return
    const w = video.clientWidth, h = video.clientHeight
    if (!w || !h) return
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    if (!result?.corners || !video.videoWidth) return
    // The frame that was read is a downscale of the video, and the video is drawn
    // to fit the element; one ratio each way or the outline sits off the paper.
    const sx = w / Math.round(video.videoWidth * Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight)))
    const sy = h / Math.round(video.videoHeight * Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight)))
    ctx.beginPath()
    result.corners.forEach((c, i) => {
      const x = c.x * sx, y = c.y * sy
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.lineWidth = 3
    ctx.strokeStyle = result.complete ? '#22c55e' : '#f59e0b'
    ctx.stroke()
  }

  async function loop() {
    while (runningRef.current) {
      try {
        const image = captureFrame(videoRef.current, workRef.current, maxEdge)
        if (image) {
          const result = readFrame(image, { layouts, roster })
          const step = liveStep(liveRef.current, result)
          liveRef.current = step.state
          setStatus({ phase: step.phase, message: step.message })
          drawOverlay(result.ok ? result : null)
          // A sheet needing a human is offered, never filed: the operator can
          // keep it with one tap and sort it out at the end of the stack.
          setPending(step.phase === 'review' ? result : null)
          if (step.accept) {
            setCount(n => n + 1)
            navigator.vibrate?.(60)
            onCapture(step.accept, 'auto')
          }
        }
      } catch (err) {
        console.error('[scan] frame failed', err)
      }
      await new Promise(r => setTimeout(r, intervalMs))
    }
  }

  async function start() {
    setError(null)
    try {
      const stream = await openCamera()
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        // Guarded on its own: play() rejects under an autoplay policy and is
        // not even implemented in jsdom, and neither is a reason to abandon the
        // scan — the stream is live and the frames are readable either way.
        try { await video.play?.() } catch { /* keep going */ }
      }
      const track = stream.getTracks()[0]
      setHasTorch(Boolean(track?.getCapabilities?.().torch))
      liveRef.current = liveInitial()
      runningRef.current = true
      setRunning(true)
      loop()
    } catch (err) {
      setError(cameraTrouble(err))
      stop()
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getTracks()[0]
    if (!track?.applyConstraints) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] })
      setTorchOn(next)
    } catch {
      setHasTorch(false)   // it said it could and then would not; stop offering it
    }
  }

  return (
    <div className={running ? LAYER : 'space-y-2'}>
      <div className="flex items-center gap-2 flex-wrap">
        {!running ? (
          <button
            type="button"
            className="btn btn-primary min-h-[44px]"
            onClick={start}
          >
            📷 Scan with the camera
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary min-h-[44px]" onClick={stop}>
              ⏹ Stop camera
            </button>
            {hasTorch && (
              <button
                type="button"
                className="btn btn-secondary min-h-[44px]"
                onClick={toggleTorch}
                aria-pressed={torchOn}
              >
                {torchOn ? '🔦 Torch on' : '🔦 Torch'}
              </button>
            )}
            <span className="text-[12px] text-ink-3">{count} read</span>
          </>
        )}
      </div>

      {error && <div className="text-[12px] text-danger" role="alert">{error}</div>}

      {/* Two boxes, not one. The outer takes the centring and may grow to fill
          the layer; the inner stays tight around the picture. That matters
          because the overlay canvas is `inset-0` against the inner box and
          drawOverlay maps the read frame onto video.clientWidth/clientHeight
          with one independent ratio per axis — correct only while that box
          matches the stream's aspect, measured at 324x243 against a 1920x1440
          stream, 1.333 both ways. Let the box stretch to fill a tall phone and
          the green "sheet found" outline lands well off the paper: a scanner
          lying about what it is looking at. */}
      <div
        className={running
          ? 'max-md:flex-1 max-md:flex max-md:items-center max-md:justify-center'
          : 'hidden'}
      >
        <div className="relative w-full max-w-[520px]">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            aria-label="Camera view of the answer sheet"
            className="w-full rounded-lg bg-black"
          />
          <canvas
            ref={overlayRef}
            aria-hidden="true"
            className="absolute inset-0 w-full pointer-events-none"
          />
          <canvas ref={workRef} className="hidden" aria-hidden="true" />
        </div>
      </div>

      {running && (
        <div
          className={`text-[13px] font-semibold ${TONE[status.phase] || 'text-ink-2'}`}
          role="status"
          aria-live="polite"
        >
          {status.message}
        </div>
      )}

      {pending && (
        <button
          type="button"
          className="btn btn-secondary btn-sm min-h-[44px]"
          onClick={() => { onCapture(pending, 'review'); setPending(null) }}
        >
          Keep this sheet to sort out later
        </button>
      )}
    </div>
  )
}
