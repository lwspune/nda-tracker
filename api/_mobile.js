// The single server-side phone normaliser.
//
// Extracted 2026-09-12 from nine byte-identical private copies (every send
// endpoint, plus student-login and student-quizzes). None of them had a direct
// test, despite this being the function that decides which number a parent
// message is delivered to and whether a login mobile matches a student or
// guardian record.
//
// Twin of the client-side `normalizeMobile` used by attendanceSlice for import
// matching — same rule, but keep them separate: this one is a boundary check on
// untrusted request input and must stay free of store imports.
//
// Underscore-prefixed: Vercel does not count it against the 12-function Hobby
// cap, but api/__tests__/importGraph.test.js still walks it, so relative
// imports here need their file extensions.

// Returns a 12-digit `91`-prefixed string, or null. NEVER a partial number — a
// caller receiving null skips that recipient and logs a SKIP line, which is the
// safe outcome; a malformed number would be dialled.
export function normMobile(m) {
  if (!m) return null
  let s = String(m).replace(/\D/g, '')
  if (s.startsWith('0') && s.length === 11) s = '91' + s.slice(1)
  if (s.length === 10) s = '91' + s
  if (s.startsWith('91') && s.length === 12) return s
  return null
}
