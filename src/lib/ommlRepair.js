// Post-conversion repair for the OMML that KaTeX -> mathml2omml produces.
//
// The conversion gets the maths RIGHT and the presentation WRONG in a handful
// of documented ways. Each function here fixes one of them, and each is pure so
// it can be pinned without building a .docx.
//
// PYQ Vault (src/lib/export/ommlBuilder.ts) carries the same idea, but its
// rewrites are NOT portable: it feeds temml, which emits different markup for
// the same LaTeX. Its `wrapAccents` targets <m:limUpp>/<m:borderBox>, neither of
// which KaTeX ever produces — porting it would be dead code. Its matrix fix is
// keyed on ASCII '|', where KaTeX emits U+2223. Copying it verbatim would have
// silently left every determinant broken, which is the majority of the cases
// this file exists for.

// ── XML safety ──────────────────────────────────────────────────────────────

// Escape raw <, > and & inside <m:t> — "0 < \alpha" otherwise yields XML Word
// refuses to open.
//
// The element test must be EXACT. `<m:t` is also a prefix of `<m:type>`, which
// mathml2omml emits inside <m:fPr> for EVERY fraction, so `<m:t([^>]*)>` matched
// `<m:type m:val="bar"/>` and the lazy body then swallowed all the live markup up
// to the next real </m:t> and escaped it — producing malformed XML that Word
// refuses outright. Require whitespace or '>' after the tag name.
export function sanitizeOmml(omml) {
  return omml.replace(/<m:t(\s[^>]*)?>([\s\S]*?)<\/m:t>/g, (_, attrs = '', body) =>
    `<m:t${attrs}>${body.replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;')}</m:t>`)
}

// ── matrices and determinants ───────────────────────────────────────────────

// mathml2omml converts the GRID of a matrix environment to a proper OMML matrix
// (<m:m>), but renders the surrounding stretchy fences as plain single-line text
// runs flanking it — so Word draws tiny, fixed-height brackets that sit BESIDE
// the matrix instead of enclosing it. Rewriting `fence-run + <m:m> + fence-run`
// into a real delimiter object (<m:d>) gives Word begChr/endChr it knows to
// stretch to the matrix height.
//
// `beg`/`end` are what we ASK WORD FOR, and are deliberately not the characters
// KaTeX emitted: U+2223 DIVIDES and U+2225 PARALLEL TO are relation operators,
// not fences. Word stretches the ASCII pipe and U+2016 DOUBLE VERTICAL LINE.
const FENCE_PAIR = {
  '(':      { close: ')',      beg: '(', end: ')' },
  '[':      { close: ']',      beg: '[', end: ']' },
  '{':      { close: '}',      beg: '{', end: '}' },
  '|':      { close: '|',      beg: '|', end: '|' },       // temml / hand-authored
  '∣': { close: '∣', beg: '|', end: '|' },        // KaTeX vmatrix  ∣
  '∥': { close: '∥', beg: '‖', end: '‖' }, // KaTeX Vmatrix ∥
  '‖': { close: '‖', beg: '‖', end: '‖' },
}

const RUN = '<m:r>(?:<m:rPr>[\\s\\S]*?</m:rPr>)?'
const OPEN_CLASS = '[(\\[{|\\u2223\\u2225\\u2016]'
const CLOSE_CLASS = '[)\\]}|\\u2223\\u2225\\u2016]'
// Matrices do not nest anywhere in this bank, so a non-greedy grid match is safe.
const GRID = '(<m:m>[\\s\\S]*?</m:m>)'

const TWO_SIDED_RE = new RegExp(
  `${RUN}<m:t[^>]*>(${OPEN_CLASS})</m:t></m:r>${GRID}${RUN}<m:t[^>]*>(${CLOSE_CLASS})</m:t></m:r>`, 'g')

// \begin{cases} opens with a brace and never closes one, so the two-sided rule
// cannot see it at all — f(x) printed with a tiny orphaned brace beside the
// grid. The lookahead keeps this from claiming a two-sided matrix whose pair
// failed to validate above.
const ONE_SIDED_RE = new RegExp(
  `${RUN}<m:t[^>]*>(\\{)</m:t></m:r>${GRID}(?!${RUN}<m:t[^>]*>${CLOSE_CLASS}</m:t></m:r>)`, 'g')

const delimiter = (beg, end, grid) =>
  `<m:d><m:dPr><m:begChr m:val="${beg}"/><m:endChr m:val="${end}"/><m:ctrlPr/></m:dPr>`
  + `<m:e>${grid}</m:e></m:d>`

export function wrapMatrixDelimiters(omml) {
  const twoSided = omml.replace(TWO_SIDED_RE, (whole, open, grid, close) => {
    const pair = FENCE_PAIR[open]
    // A mismatched open/close is left untouched rather than guessed at.
    if (!pair || pair.close !== close) return whole
    return delimiter(pair.beg, pair.end, grid)
  })
  return twoSided.replace(ONE_SIDED_RE, (_whole, _open, grid) =>
    delimiter('{', '', grid))
}

// ── accents ─────────────────────────────────────────────────────────────────

// KaTeX gets the STRUCTURE right — \bar and \overline both arrive as <m:acc>,
// so PYQ Vault's limUpp/borderBox rewrites have nothing to do here. What it gets
// wrong is the character: it hands Word a SPACING glyph (U+02C9 modifier macron,
// U+203E overline). Word can only position a COMBINING mark over the base, so a
// spacing one renders beside it. \vec, \hat, \tilde and \dot already arrive
// combining and must be left alone.
const ACCENT_REMAP = {
  'ˉ': '̅', // ˉ modifier macron   -> combining overline
  '‾': '̅', // ‾ overline          -> combining overline
  '¯': '̅', // ¯ macron            -> combining overline
  'ˆ': '̂', // ˆ modifier hat      -> combining circumflex
  '˜': '̃', // ˜ small tilde       -> combining tilde
  '˙': '̇', // ˙ dot above         -> combining dot above
}

// Scoped to <m:accPr> on purpose: <m:chr> is ALSO how an n-ary operator carries
// its symbol (<m:naryPr><m:chr m:val="∫"/>), and a document-wide remap by value
// would be a different bug waiting for a different accent table.
export function remapAccentChars(omml) {
  return omml.replace(/<m:accPr>([\s\S]*?)<\/m:accPr>/g, (_whole, inner) =>
    `<m:accPr>${inner.replace(/<m:chr m:val="([\s\S])"\/>/g,
      (run, ch) => (ACCENT_REMAP[ch] ? `<m:chr m:val="${ACCENT_REMAP[ch]}"/>` : run))}</m:accPr>`)
}

// ── structural guard ────────────────────────────────────────────────────────

/**
 * Element-nesting check over an OMML fragment. Returns a human-readable
 * description of the first structural fault, or null when every tag is properly
 * closed in order.
 *
 * Malformed OMML is not a cosmetic problem: Word validates word/document.xml
 * strictly and refuses to open the file AT ALL, so ONE bad equation costs the
 * student the entire practice set. Cheap enough to run on every conversion.
 *
 * Structural only — tag pairing, not schema validity. Self-closing tags are
 * skipped; <m:t> bodies have already had their </> escaped by sanitizeOmml, so
 * maths text cannot be mistaken for markup. Pure.
 */
export function ommlNestingError(xml) {
  const stack = []
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g
  let m
  while ((m = tag.exec(xml))) {
    const [, closing, name, attrs, selfClosing] = m
    if (selfClosing === '/' || attrs.endsWith('/')) continue
    if (closing === '/') {
      const open = stack.pop()
      if (open !== name) return `</${name}> closes <${open ?? 'nothing'}>`
    } else {
      stack.push(name)
    }
  }
  return stack.length ? `unclosed <${stack.join('>, <')}>` : null
}

/**
 * The whole repair pass: escape, enclose matrices, fix accent characters, then
 * refuse the result if any of that produced markup Word would reject.
 *
 * Returns null when the OMML is unusable, so the caller falls back to readable
 * text instead of shipping a file that will not open.
 */
export function repairOmml(omml) {
  if (!omml || typeof omml !== 'string') return null
  const out = remapAccentChars(wrapMatrixDelimiters(sanitizeOmml(omml)))
  return ommlNestingError(out) ? null : out
}
