// Guard for text bound for a jsPDF document.
//
// jsPDF ships only the 14 Standard Type1 fonts, all WinAnsiEncoding — a
// 256-slot single-byte table. Devanagari (U+0900–U+097F) has no slot in it, so
// a Marathi or Hindi exam title prints as scattered Latin letters rather than
// text: `२. बिल्ली का बिलुंगडा` came out as ` 2 . , ? 2 M 2 @ `.
//
// Embedding a Unicode font would supply the glyphs but NOT the shaping —
// Devanagari reorders matras (the `ि` in `बिल्ली` is stored after `ब` and drawn
// before it) and merges conjuncts (`ल` + `्` + `ल` → `ल्ल`). jsPDF has no
// shaping engine, so that route yields text that looks right and is misspelled,
// which on a parent-facing report card is worse than obvious garbage.
//
// So the PDF substitutes English at the point of failure, and only mechanically:
// the exam's own (Latin) subject plus its chapter number. Devanagari DIGITS map
// one-to-one onto ASCII so converting them is exact; transliterating WORDS would
// be guesswork and is deliberately not attempted. The stored name is untouched —
// the admin page, student portal and Word export all still show the real title.

// WinAnsiEncoding is CP1252, NOT Latin-1 — the difference is load-bearing. Its
// 0x80–0x9F block holds typographic punctuation whose code points sit far above
// U+00FF: en/em dashes, curly quotes, the bullet, the ellipsis. A naive
// `codePoint > 0xFF` test rejects all of them, including the em dash this
// module's own fallback emits.
//
// Conversely the raw C1 range U+0080–U+009F is undefined in CP1252, so it is
// excluded rather than passed through with the rest of the high bytes.
const WINANSI_EXTRAS = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6,
  0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C,
  0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A,
  0x0153, 0x017E, 0x0178,
])

// U+0966–U+096F, in order.
const DEVANAGARI_ZERO = 0x0966

export function isWinAnsiSafe(text) {
  const s = String(text ?? '')
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    if (cp <= 0x7F) continue                      // ASCII
    if (cp >= 0xA0 && cp <= 0xFF) continue        // Latin-1 supplement
    if (WINANSI_EXTRAS.has(cp)) continue          // CP1252 punctuation block
    return false
  }
  return true
}

// Devanagari digits → ASCII. Everything else is passed through untouched.
export function asciiDigits(text) {
  return String(text ?? '').replace(/[०-९]/g, d =>
    String(d.codePointAt(0) - DEVANAGARI_ZERO),
  )
}

// The chapter number a title opens with, as an ASCII string, or null.
//
// These titles come from a textbook index, so they lead with the chapter number
// in either script (`2.`, `३.`, `2.आ)`). Anchored at the start so a number
// inside the title ("Unit Test 1: Maths") is never mistaken for one.
export function leadingChapterNo(name) {
  const m = /^\s*([0-9०-९]+)/.exec(String(name ?? ''))
  return m ? asciiDigits(m[1]) : null
}

// The label to print in a PDF for an exam. Latin names pass through verbatim —
// which is every exam bar the language quizzes.
export function pdfSafeExamLabel({ name, subject } = {}) {
  const raw = String(name ?? '')
  if (!raw.trim()) return ''
  if (isWinAnsiSafe(raw)) return raw

  // A subject is faculty-entered free text, so it can be unprintable too;
  // falling back to it blindly would just move the garbling one column over.
  const subj = String(subject ?? '').trim()
  const head = subj && isWinAnsiSafe(subj) ? subj : 'Exam'

  const ch = leadingChapterNo(raw)
  return ch ? `${head} — Ch. ${ch}` : head   // — = em dash, in WinAnsi
}
