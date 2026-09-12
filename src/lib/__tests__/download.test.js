import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadBlob, safeFilename } from '../download'

// Two helpers that were copy-pasted ten and seven times respectively before
// 2026-09-12. Unlike the auth and blocked-contact gates, these encode a
// MECHANIC and a FORMAT rather than a rule — a wrong copy fails loudly (no
// download, or a filename the OS rejects) rather than silently, which is why 17
// copies accumulated without an incident.

describe('safeFilename', () => {
  it('keeps letters, digits, underscore and hyphen', () => {
    expect(safeFilename('Mock_Test-5')).toBe('Mock_Test-5')
  })

  it('collapses every other run to a single underscore', () => {
    expect(safeFilename('NDA Maths: Blueprint mock 4')).toBe('NDA_Maths_Blueprint_mock_4')
    expect(safeFilename('a///b')).toBe('a_b')
  })

  it('trims leading and trailing underscores', () => {
    expect(safeFilename('  spaced  ')).toBe('spaced')
    expect(safeFilename('///x///')).toBe('x')
  })

  // Devanagari student names are real in this roster; a filename made only of
  // them would otherwise collapse to '' and produce a nameless file.
  it('falls back when nothing survives', () => {
    expect(safeFilename('आशा')).toBe('file')
    expect(safeFilename('आशा', 'student')).toBe('student')
    expect(safeFilename('')).toBe('file')
    expect(safeFilename(null)).toBe('file')
    expect(safeFilename(undefined, 'exam')).toBe('exam')
  })

  it('survives the characters that actually break a download', () => {
    // Colon and slash are the two that make Windows refuse the save outright.
    expect(safeFilename('Maths: 1/2 term')).toBe('Maths_1_2_term')
  })
})

describe('downloadBlob', () => {
  let created, revoked, clicked, anchor

  beforeEach(() => {
    created = []; revoked = []; clicked = 0
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(b => { created.push(b); return 'blob:fake-url' }),
      revokeObjectURL: vi.fn(u => revoked.push(u)),
    })
    anchor = { href: '', download: '', click: vi.fn(() => { clicked++ }), remove: vi.fn() }
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => anchor)
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('points an anchor at the blob and clicks it', () => {
    const blob = new Blob(['x'])
    downloadBlob(blob, 'report.pdf')
    expect(created).toEqual([blob])
    expect(anchor.href).toBe('blob:fake-url')
    expect(anchor.download).toBe('report.pdf')
    expect(clicked).toBe(1)
  })

  // Load-bearing: an object URL pins its blob in memory until revoked, and
  // these blobs are whole PDFs and .docx files. Every copy did this; keeping it
  // pinned in one place means it cannot be forgotten in copy eleven.
  it('revokes the object URL and removes the anchor', () => {
    downloadBlob(new Blob(['x']), 'report.pdf')
    expect(revoked).toEqual(['blob:fake-url'])
    expect(anchor.remove).toHaveBeenCalled()
  })

  it('still cleans up when the click throws', () => {
    anchor.click = vi.fn(() => { throw new Error('popup blocked') })
    expect(() => downloadBlob(new Blob(['x']), 'report.pdf')).toThrow('popup blocked')
    expect(revoked).toEqual(['blob:fake-url'])
    expect(anchor.remove).toHaveBeenCalled()
  })
})
