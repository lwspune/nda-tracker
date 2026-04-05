import katex from 'katex'

// Renders a string that may contain \(...\) LaTeX inline expressions
// Falls back to plain text if KaTeX throws
export function Math({ children, className = '' }) {
  if (!children) return null

  const rendered = renderMixed(String(children))
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  )
}

// Splits text on \(...\) delimiters and renders each segment
function renderMixed(text) {
  // Split on \( and \) delimiters
  const parts = text.split(/(\\\([\s\S]*?\\\))/g)
  return parts.map(part => {
    if (part.startsWith('\\(') && part.endsWith('\\)')) {
      const latex = part.slice(2, -2)
      try {
        return katex.renderToString(latex, {
          throwOnError: false,
          displayMode: false,
          strict: false,
        })
      } catch {
        return escHtml(latex)
      }
    }
    return escHtml(part)
  }).join('')
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
