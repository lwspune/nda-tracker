import { renderMathHtml } from '../../lib/mathHtml'

// Renders stored question text: inline and display LaTeX, Markdown **bold**,
// and underlined vocabulary.
//
// This used to do its own `\(...\)` split and escape everything else, which
// meant `**bold**` printed as asterisks and `\[...\]` printed as raw LaTeX —
// on every question surface in the app, including the student's own result
// review. `src/lib/richText.js` already solved all of it for the Word exports;
// this now uses the same parser, so screen and export agree.
//
// The rendering itself moved to `src/lib/mathHtml.js` so the class PDF's
// question cards — built as HTML and captured offscreen, no React involved —
// can share it rather than growing a second renderer that drifts from this one.
//
// GFM pipe tables are handled one level up, by `RichText` — see that file.
export function Math({ children, className = '' }) {
  if (!children) return null

  const html = renderMathHtml(String(children))
  if (!html) return null

  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
