import { describe, it, expect, vi } from 'vitest'
import { sendHomework, readPickedFiles, needsSinglePageConfirm } from '../studentUpload'

const file = (name, type = 'image/jpeg', size = 100) => ({ name, type, size })

function fakes({ startStatus = 200, submitStatus = 200, failPage = null } = {}) {
  const calls = []
  const post = vi.fn(async body => {
    calls.push(['post', body.kind, body])
    if (body.kind === 'homework-start') {
      return startStatus === 200
        ? { ok: true, status: 200, body: { submissionId: 's1', uploads: [{ path: 'a/L/s1/01.jpg', token: 't1' }, { path: 'a/L/s1/02.jpg', token: 't2' }] } }
        : { ok: false, status: startStatus, body: { error: 'The deadline for this homework has passed.' } }
    }
    return submitStatus === 200
      ? { ok: true, status: 200, body: { ok: true } }
      : { ok: false, status: submitStatus, body: { error: 'Some pages did not finish uploading.' } }
  })
  const upload = vi.fn(async (path, token, f) => {
    calls.push(['upload', path, token, f.name])
    return path.endsWith(`0${failPage}.jpg`) ? { error: { message: 'network' } } : { error: null }
  })
  return { post, upload, calls }
}

const args = extra => ({ mobile: '9876543210', lwsId: 'L1', assignmentId: 'a1', files: [file('p1.jpg'), file('p2.jpg')], ...extra })

describe('sendHomework', () => {
  it('starts, uploads every page to its own link in order, then submits', async () => {
    const f = fakes()
    const progress = vi.fn()
    const r = await sendHomework({ ...args(), post: f.post, upload: f.upload, onProgress: progress })
    expect(r).toEqual({ ok: true })
    expect(f.calls.map(c => c.slice(0, 2))).toEqual([
      ['post', 'homework-start'], ['upload', 'a/L/s1/01.jpg'], ['upload', 'a/L/s1/02.jpg'], ['post', 'homework-submit'],
    ])
    expect(f.calls[1].slice(2)).toEqual(['t1', 'p1.jpg'])
    expect(f.calls[0][2]).toMatchObject({ mobile: '9876543210', lwsId: 'L1', assignmentId: 'a1', files: [{ type: 'image/jpeg', size: 100 }, { type: 'image/jpeg', size: 100 }] })
    expect(f.calls[3][2]).toMatchObject({ submissionId: 's1' })
    expect(progress).toHaveBeenLastCalledWith(2, 2)
  })

  // Only the file's type and size go in the start request — never the bytes.
  it('sends no file contents to the API', async () => {
    const f = fakes()
    await sendHomework({ ...args(), post: f.post, upload: f.upload })
    expect(Object.keys(f.calls[0][2].files[0]).sort()).toEqual(['size', 'type'])
  })

  it('stops with the server\'s reason when the start is refused', async () => {
    const f = fakes({ startStatus: 409 })
    const r = await sendHomework({ ...args(), post: f.post, upload: f.upload })
    expect(r).toEqual({ ok: false, error: 'The deadline for this homework has passed.' })
    expect(f.upload).not.toHaveBeenCalled()
  })

  it('names the page that failed and does not submit', async () => {
    const f = fakes({ failPage: 2 })
    const r = await sendHomework({ ...args(), post: f.post, upload: f.upload })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/page 2/i)
    expect(f.calls.some(c => c[1] === 'homework-submit')).toBe(false)
  })

  // 2026-10-13: the real error was swallowed behind "check your connection",
  // which sent a student round the same failing retry eleven times.
  it('keeps the real error and says how to recover, without blaming the connection', async () => {
    const f = fakes({ failPage: 2 })
    const r = await sendHomework({ ...args(), post: f.post, upload: f.upload })
    expect(r.error).toMatch(/network/)
    expect(r.error).toMatch(/remove/i)
    expect(r.error).toMatch(/then submit/i)
    expect(r.error).not.toMatch(/check your connection/i)
  })

  it('treats a thrown upload as a failed page, not a crash', async () => {
    const f = fakes()
    const upload = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const r = await sendHomework({ ...args(), post: f.post, upload })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/page 1/i)
    expect(r.error).toMatch(/Failed to fetch/)
  })

  it('reports a refused submit', async () => {
    const f = fakes({ submitStatus: 409 })
    const r = await sendHomework({ ...args(), post: f.post, upload: f.upload })
    expect(r).toEqual({ ok: false, error: 'Some pages did not finish uploading.' })
  })

  it('refuses a mismatch between pages picked and upload links issued', async () => {
    const f = fakes()
    const r = await sendHomework({ ...args({ files: [file('only.jpg')] }), post: f.post, upload: f.upload })
    expect(r.ok).toBe(false)
    expect(f.upload).not.toHaveBeenCalled()
  })
})

// A phone's file picker hands back a link to the photo, not the photo; the
// upload used to re-read it only at Submit, by which time it could be gone.
describe('readPickedFiles', () => {
  it('returns in-memory copies with the same name, type and contents', async () => {
    const picked = [new File(['abc'], 'p1.jpg', { type: 'image/jpeg' }), new File(['%PDF'], 'p2.pdf', { type: 'application/pdf' })]
    const r = await readPickedFiles(picked)
    expect(r.ok).toBe(true)
    expect(r.files.map(f => [f.name, f.type, f.size])).toEqual([['p1.jpg', 'image/jpeg', 3], ['p2.pdf', 'application/pdf', 4]])
    expect(r.files[0]).not.toBe(picked[0])
    expect(await r.files[0].text()).toBe('abc')
  })

  it('refuses at pick time a file the phone cannot read, naming it', async () => {
    const bad = new File(['x'], 'IMG_2041.jpg', { type: 'image/jpeg' })
    bad.arrayBuffer = () => Promise.reject(new DOMException('could not be read', 'NotReadableError'))
    const r = await readPickedFiles([new File(['a'], 'ok.jpg', { type: 'image/jpeg' }), bad])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/IMG_2041\.jpg/)
    expect(r.error).toMatch(/again/i)
  })

  it('refuses a file that reads back empty', async () => {
    const empty = new File(['abc'], 'p.jpg', { type: 'image/jpeg' })
    empty.arrayBuffer = async () => new ArrayBuffer(0)
    const r = await readPickedFiles([empty])
    expect(r.ok).toBe(false)
  })
})

// Submitting is final; a lone photo is the shape of "I thought Submit sent
// this page". A lone PDF is a whole scanned answer and needs no question.
describe('needsSinglePageConfirm', () => {
  const img = { type: 'image/jpeg' }
  const pdf = { type: 'application/pdf' }
  it('asks for a single photo', () => expect(needsSinglePageConfirm([img])).toBe(true))
  it('does not ask for a single PDF', () => expect(needsSinglePageConfirm([pdf])).toBe(false))
  it('does not ask for several pages', () => expect(needsSinglePageConfirm([img, img])).toBe(false))
  it('does not ask for nothing', () => expect(needsSinglePageConfirm([])).toBe(false))
})
