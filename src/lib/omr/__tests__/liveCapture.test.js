import { describe, it, expect } from 'vitest'
import { liveInitial, liveStep, sheetSignature } from '../liveCapture'

const ok = (o = {}) => ({
  ok: true, complete: true, reviewCount: 0,
  answers: { 1: 'A', 2: 'C' },
  roll: { digits: '00013', review: false },
  student: { lwsId: 'LWS-013', review: false },
  ...o,
})
const bad = (reason = 'Only 3 registration marks found — is the whole sheet in frame?') =>
  ({ ok: false, reason })

/** Feed frames in order, returning every step. */
function run(frames, opts) {
  let state = liveInitial()
  return frames.map(f => {
    const step = liveStep(state, f, opts)
    state = step.state
    return step
  })
}

describe('sheetSignature', () => {
  it('is the same for two reads of the same filled sheet', () => {
    expect(sheetSignature(ok())).toBe(sheetSignature(ok()))
  })

  it('differs when a single answer differs', () => {
    expect(sheetSignature(ok())).not.toBe(sheetSignature(ok({ answers: { 1: 'A', 2: 'D' } })))
  })

  it('differs when the roll differs', () => {
    expect(sheetSignature(ok())).not.toBe(sheetSignature(ok({ roll: { digits: '00014' } })))
  })

  it('is null for a frame with no sheet in it', () => {
    expect(sheetSignature(bad())).toBeNull()
  })
})

describe('liveStep', () => {
  // One frame is a guess; two frames that agree exactly is a reading. Nothing is
  // filed off a single frame — a hand moving over the paper, or a glare band
  // across one row, changes an answer without changing anything a human sees.
  it('does not file a sheet off one frame', () => {
    const [first] = run([ok()])
    expect(first.accept).toBeNull()
    expect(first.phase).toBe('holding')
  })

  it('files it when two consecutive frames read identically', () => {
    const steps = run([ok(), ok()])
    expect(steps[1].accept).not.toBeNull()
    expect(steps[1].accept.student.lwsId).toBe('LWS-013')
    expect(steps[1].phase).toBe('accepted')
  })

  it('starts counting again when the second frame disagrees', () => {
    const steps = run([ok(), ok({ answers: { 1: 'B', 2: 'C' } }), ok({ answers: { 1: 'B', 2: 'C' } })])
    expect(steps[1].accept).toBeNull()
    expect(steps[2].accept).not.toBeNull()
    expect(steps[2].accept.answers[1]).toBe('B')
  })

  // Without this the same sheet is filed on every frame for as long as it sits
  // under the lens.
  it('will not file the same sheet twice while it stays in frame', () => {
    const steps = run([ok(), ok(), ok(), ok()])
    expect(steps.filter(s => s.accept).length).toBe(1)
  })

  it('takes the next sheet once the last one has left the frame', () => {
    const next = ok({ roll: { digits: '00048' }, student: { lwsId: 'LWS-048', review: false } })
    const steps = run([ok(), ok(), bad(), bad(), bad(), next, next])
    expect(steps.filter(s => s.accept).length).toBe(2)
    expect(steps[6].accept.student.lwsId).toBe('LWS-048')
  })

  // A single dropped frame mid-shot is normal; it must not mean "sheet gone".
  it('does not treat one lost frame as the sheet leaving', () => {
    const steps = run([ok(), ok(), bad(), ok(), ok()])
    expect(steps.filter(s => s.accept).length).toBe(1)
  })

  it('refuses a student it has already filed in this session', () => {
    const steps = run([ok(), ok(), bad(), bad(), bad(), ok(), ok()])
    expect(steps.filter(s => s.accept).length).toBe(1)
    expect(steps[6].phase).toBe('duplicate')
    expect(steps[6].message).toMatch(/already/i)
  })

  // A flagged question or an unknown roll is a decision for a human, and a
  // human is not looking at a viewfinder while holding a stack of paper.
  it('never files a sheet that still needs a human', () => {
    const steps = run([
      ok({ complete: false, reviewCount: 1 }),
      ok({ complete: false, reviewCount: 1 }),
    ])
    expect(steps[1].accept).toBeNull()
    expect(steps[1].phase).toBe('review')
  })

  it('never files a sheet whose student could not be resolved', () => {
    const unknown = ok({ complete: false, student: { lwsId: null, review: true, reason: 'No roll marked' } })
    const steps = run([unknown, unknown])
    expect(steps[1].accept).toBeNull()
  })

  // The reader's own refusal text is the best coaching there is — it already
  // says whether the sheet is out of frame or the wrong paper entirely.
  it('passes the reader’s reason through as the message', () => {
    const [step] = run([bad('This looks like a 2x6 sheet, but this exam prints 5x11.')])
    expect(step.phase).toBe('hunting')
    expect(step.message).toMatch(/2x6 sheet/)
  })

  it('says to hold still once it has a candidate', () => {
    const [step] = run([ok()])
    expect(step.message).toMatch(/hold/i)
  })

  it('does not mutate the state it was given', () => {
    const state = liveInitial()
    liveStep(state, ok())
    expect(state).toEqual(liveInitial())
  })

  it('honours a stricter agreement requirement', () => {
    const steps = run([ok(), ok(), ok()], { minAgree: 3 })
    expect(steps[1].accept).toBeNull()
    expect(steps[2].accept).not.toBeNull()
  })
})
