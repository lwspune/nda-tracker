import { Math } from './Math'
import { parseTableBlocks } from '../../lib/richText'

// Question content that MAY contain a GFM pipe table — data-interpretation
// items store their frequency distributions that way, and the screen used to
// print them as a wall of pipes and dashes.
//
// Mirrors PYQ Vault's `BlockText.tsx`, over a `parseTableBlocks` that is
// line-for-line equivalent to theirs. Including its FAST PATH: text with no
// table (the overwhelming majority) returns a bare <Math>, so the render is
// byte-for-byte what it was before this component existed. That is what makes
// swapping it into QuestionCard a safe change rather than a redesign of every
// question in the app.
export function RichText({ children, className = '' }) {
  if (!children) return null
  const text = String(children)
  const blocks = parseTableBlocks(text)

  if (blocks.length === 0) return <Math className={className}>{text}</Math>
  if (blocks.length === 1 && blocks[0].kind === 'text') {
    return <Math className={className}>{blocks[0].text}</Math>
  }

  return (
    <div className={className}>
      {blocks.map((b, i) => b.kind === 'text' ? (
        <Math key={i}>{b.text}</Math>
      ) : (
        // Its own scroll box: a wide distribution must never widen the page.
        <div key={i} className="my-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[12px]">
            <thead className="bg-bg">
              <tr>
                {b.headers.map((h, j) => (
                  <th
                    key={j}
                    scope="col"
                    className={`px-2.5 py-1.5 text-left font-semibold ${j > 0 ? 'border-l border-border' : ''}`}
                  >
                    <Math>{h}</Math>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r} className="border-t border-border">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={`px-2.5 py-1.5 align-top ${c > 0 ? 'border-l border-border' : ''}`}
                    >
                      <Math>{cell}</Math>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
