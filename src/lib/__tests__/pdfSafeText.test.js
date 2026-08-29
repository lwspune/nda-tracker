import { describe, it, expect } from 'vitest'
import { isWinAnsiSafe, asciiDigits, leadingChapterNo, pdfSafeExamLabel } from '../pdfSafeText'

describe('isWinAnsiSafe', () => {
  it('accepts plain Latin text', () => {
    expect(isWinAnsiSafe('Unit Test 1: Maths - I (9th)')).toBe(true)
    expect(isWinAnsiSafe('Life & A Synopsis')).toBe(true)
  })

  // The report already prints " \xB7 " as a separator, and pctColor-adjacent
  // copy uses en dashes — both live in WinAnsi and must not trip the guard.
  it('accepts the WinAnsi punctuation the report already uses', () => {
    expect(isWinAnsiSafe('Maths \xB7 Sets')).toBe(true)
    expect(isWinAnsiSafe('1 Jul – 29 Aug 2026')).toBe(true)
  })

  // WinAnsi is CP1252, not Latin-1 — these sit above U+00FF but are encodable.
  // The em dash matters most: pdfSafeExamLabel emits one, so a guard that
  // rejected it would flag its own output as unprintable.
  it('accepts the CP1252 punctuation block', () => {
    expect(isWinAnsiSafe('—')).toBe(true)   // U+2014, the fallback separator
    expect(isWinAnsiSafe('“curly” ‘quotes’ … • ™')).toBe(true)
  })

  it('rejects the undefined C1 control range', () => {
    expect(isWinAnsiSafe('\u0085')).toBe(false)
    expect(isWinAnsiSafe('\u009F')).toBe(false)
  })

  it('rejects Devanagari', () => {
    expect(isWinAnsiSafe('२. बिल्ली का बिलुंगडा')).toBe(false)
    expect(isWinAnsiSafe('३. कबीर')).toBe(false)
  })

  it('rejects a string that is only partly Devanagari', () => {
    expect(isWinAnsiSafe('2. बिल्ली')).toBe(false)
  })

  it('treats blank and nullish as safe — there is nothing to garble', () => {
    expect(isWinAnsiSafe('')).toBe(true)
    expect(isWinAnsiSafe(null)).toBe(true)
    expect(isWinAnsiSafe(undefined)).toBe(true)
  })
})

describe('asciiDigits', () => {
  // Devanagari digits map one-to-one onto ASCII, so this conversion is exact.
  // Transliterating WORDS would be guesswork; digits are not.
  it('converts Devanagari digits to ASCII', () => {
    expect(asciiDigits('०१२३४५६७८९')).toBe('0123456789')
  })

  it('leaves ASCII digits and letters alone', () => {
    expect(asciiDigits('2. Chapter')).toBe('2. Chapter')
  })

  it('converts only the digits, leaving other Devanagari in place', () => {
    expect(asciiDigits('३. कबीर')).toBe('3. कबीर')
  })
})

describe('leadingChapterNo', () => {
  it('reads an ASCII leading number', () => {
    expect(leadingChapterNo('2. बिल्ली का बिलुंगडा')).toBe('2')
  })

  it('reads a Devanagari leading number', () => {
    expect(leadingChapterNo('३. कबीर')).toBe('3')
  })

  it('reads the number when a sub-part follows', () => {
    expect(leadingChapterNo('2.आ) संतकृपा झाली')).toBe('2')
  })

  it('returns null when the title has no leading number', () => {
    expect(leadingChapterNo('योगी सर्वकाळ सुखदाता')).toBe(null)
    expect(leadingChapterNo('Life & A Synopsis')).toBe(null)
  })

  it('does not treat a mid-string number as the chapter', () => {
    expect(leadingChapterNo('Unit Test 1: Maths')).toBe(null)
  })
})

describe('pdfSafeExamLabel', () => {
  // The overwhelmingly common case: leave it completely alone.
  it('returns a Latin name unchanged', () => {
    expect(pdfSafeExamLabel({ name: 'Unit Test 1: Maths - I (9th)', subject: 'Maths' }))
      .toBe('Unit Test 1: Maths - I (9th)')
  })

  it('falls back to subject + chapter number for a Devanagari name', () => {
    expect(pdfSafeExamLabel({ name: '२. बिल्ली का बिलुंगडा', subject: 'Hindi' }))
      .toBe('Hindi — Ch. 2')
    expect(pdfSafeExamLabel({ name: '३. बेटा मी ऐकतो आहे', subject: 'Marathi' }))
      .toBe('Marathi — Ch. 3')
  })

  it('falls back to the subject alone when there is no chapter number', () => {
    expect(pdfSafeExamLabel({ name: 'योगी सर्वकाळ सुखदाता', subject: 'Marathi' }))
      .toBe('Marathi')
  })

  // Never emit an empty Subject cell: a row with no label reads as a rendering
  // failure, which is the thing this helper exists to prevent.
  it('falls back to a generic word when the subject is missing too', () => {
    expect(pdfSafeExamLabel({ name: '३. कबीर', subject: '' })).toBe('Exam — Ch. 3')
    expect(pdfSafeExamLabel({ name: 'योगी', subject: null })).toBe('Exam')
  })

  // A subject is faculty-entered free text, so it can itself be non-Latin.
  it('does not emit a subject that is itself unprintable', () => {
    expect(pdfSafeExamLabel({ name: '३. कबीर', subject: 'हिंदी' })).toBe('Exam — Ch. 3')
  })

  it('handles a missing name without throwing', () => {
    expect(pdfSafeExamLabel({ name: '', subject: 'Hindi' })).toBe('')
    expect(pdfSafeExamLabel({})).toBe('')
  })
})
