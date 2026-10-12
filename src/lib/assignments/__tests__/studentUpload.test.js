import { describe, it, expect, vi } from 'vitest'
import { sendHomework } from '../studentUpload'

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
