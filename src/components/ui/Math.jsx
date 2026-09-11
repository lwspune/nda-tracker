import katex from 'katex'
import { parseRichSegments } from '../../lib/richText'
import { matchUnderlineBypass } from '../../lib/underlineBypass'

// Renders stored question text: inline and display LaTeX, Markdown **bold**,
// and underlined vocabulary.
//
// This used to do its own `\(...\)` split and escape everything else, which
// meant `**bold**` printed as asterisks and `\[...\]` printed as raw LaTeX —
// on every question surface in the app, including the student's own result
// review. `src/lib/richText.js` already solved all of it for the Word exports;
// this now uses the same parser, so screen and export agree.
//
// GFM pipe tables are handled one level up, by `RichText` — see that file.
export function Math({ children, className = '' }) {
  if (!children) return null

  const segments = parseRichSegments(String(children))
  if (segments.length === 0) return null

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: segments.map(renderSegment).join('') }}
    />
  )
}

function renderSegment(seg) {
  if (seg.type === 'text') return bold(escHtml(seg.content), seg.bold)

  // An underline-only zone is vocabulary, not maths: KaTeX would typeset it in
  // its own face mid-sentence and wrap it in an inline-block that breaks line
  // clamping. Render it in the body font instead.
  if (seg.type === 'inline') {
    const u = matchUnderlineBypass(seg.content)
    if (u) {
      const word = `<span style="text-decoration:underline"${u.italic ? ' class="italic"' : ''}>${escHtml(u.word)}</span>`
      return bold(word + escHtml(u.trailing), seg.bold)
    }
  }

  try {
    return bold(katex.renderToString(seg.content, {
      throwOnError: false,
      displayMode: seg.type === 'block',
      strict: false,
    }), seg.bold)
  } catch {
    // Malformed LaTeX shows as its source rather than taking the page down.
    return bold(escHtml(seg.content), seg.bold)
  }
}

function bold(html, isBold) {
  return isBold ? `<strong>${html}</strong>` : html
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
