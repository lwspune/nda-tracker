// Looking a homework question up in PYQ Vault, for its stored solution. PURE.
//
// Used by scripts/grading/vault.js while grading. A vault solution is a
// reference, like a teacher's answer key: it shows the expected steps and the
// conditions a board answer states, and it can be wrong. Grading still works
// every answer out and gives any correct method full marks (GRADING.md).
//
// PYQ Vault is a separate Supabase project, so this is a REST path, not a query
// against the tracker's database.

export const MIN_TERM_CHARS = 4

const SELECT = 'id,text,solution,pyq_year,marks'

// ['pair of lines', 'acute angle'] → a PostgREST path matching questions whose
// text contains every phrase. Stored maths is LaTeX (`ax^{2} + 2hxy`), so
// plain-word phrases from the question find it most reliably.
export function vaultSearchPath(terms, { limit = 5 } = {}) {
  const phrases = (terms ?? []).map(t => String(t ?? '').trim()).filter(Boolean)
  if (phrases.length === 0) throw new Error('Give at least one phrase from the question.')
  const short = phrases.find(p => p.length < MIN_TERM_CHARS)
  if (short) throw new Error(`"${short}" is too short to search on: use phrases of ${MIN_TERM_CHARS}+ characters.`)
  const filters = phrases.map(p => `text=ilike.*${encodeURIComponent(p)}*`).join('&')
  return `questions?select=${SELECT}&${filters}&order=pyq_year.desc.nullslast&limit=${limit}`
}

export function formatVaultHit(q) {
  const meta = [q.pyq_year, q.marks != null ? `${q.marks} marks` : null].filter(Boolean).join(' · ')
  return [
    `── ${q.id}${meta ? `  (${meta})` : ''}`,
    `QUESTION: ${q.text ?? ''}`,
    q.solution ? `SOLUTION: ${q.solution}` : 'SOLUTION: (no stored solution)',
  ].join('\n')
}
