/**
 * Ported from PYQ Vault's `src/components/math/underlineBypass.ts`.
 *
 * The bank stores an underlined word (NDA English vocab/idioms, NDA Biology
 * taxonomy) as a KaTeX math zone: `\(\underline{\text{absently}}\)` or
 * `\(\underline{\textit{Homo sapiens}}\)`. Routing that through KaTeX typesets
 * the word in KaTeX_Main — a different typeface mid-sentence — and wraps it in
 * an inline-block that breaks line clamping. So when an inline-math segment is
 * EXACTLY this pattern, render a native underlined span in the body font.
 *
 * Anything else — genuine maths, chained `\text{}\text{}`, or an underline
 * inside a larger expression — does not match and falls through to KaTeX.
 *
 * NOTE: the bank keeps this in sync with its OMML builder, which has the same
 * pattern. This app's docx path has no underline handling at all, so there is
 * nothing here to stay in sync with yet — if one is ever added, these two
 * patterns must match.
 */
export const UNDERLINE_BYPASS_RE =
  /^\s*\\underline\{\s*\\(text|textit)\{([^{}]+)\}\s*\}\s*([.,;:!?]?)\s*$/

/**
 * @param {string} content an inline-math segment WITHOUT its delimiters
 * @returns {{word: string, italic: boolean, trailing: string} | null}
 */
export function matchUnderlineBypass(content) {
  const m = UNDERLINE_BYPASS_RE.exec(String(content ?? ''))
  if (!m) return null
  return { word: m[2], italic: m[1] === 'textit', trailing: m[3] ?? '' }
}
