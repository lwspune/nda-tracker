// Pure helpers for entering an OFFLINE exam's marks in-app instead of via a
// hand-built spreadsheet.
//
// The app already knows who is in each batch, so re-typing the roster into Excel
// just to upload it back is wasted work — and hand-typed names create new
// spelling variants the dedup machinery then has to reconcile. These helpers
// derive the roster from `studentProfiles` and turn typed marks into the same
// student-row shape `parseOfflineResults` produces, so both paths converge on
// one exam object.

import { isBlockedStatus } from './accountStatus'

// Current members of the selected batches, as [{ lwsId, name }] sorted by name.
//
// Mirrors getBatchMemberNames' membership rule (current `profile.batches[]`, not
// an exam roster) but returns ONE row per student: `studentProfiles` is keyed by
// canonical name AND by every name variant pointing at the same entry, so the
// `p.name === key` guard is what stops a variant becoming its own roster row.
// Blocked / Quit / Inactive students are excluded — they are not attending, so
// they should not appear as blank rows that then read as absentees. (Upload a
// file if one genuinely needs recording.)
export function buildOfflineRoster(studentProfiles, batchNames) {
  const wanted = new Set(batchNames || [])
  if (!wanted.size) return []

  const roster = []
  for (const [key, p] of Object.entries(studentProfiles || {})) {
    if (!p || p.name !== key) continue
    if (isBlockedStatus(p.accountStatus)) continue
    if (!(p.batches || []).some(b => wanted.has(b))) continue
    roster.push({ lwsId: p.lwsId || '', name: p.name })
  }
  return roster.sort((a, b) => a.name.localeCompare(b.name))
}

// Parses a pasted column of marks into (number | null)[], top-down, for filling
// the grid in roster order. Blank and non-numeric cells become null (= not
// entered) rather than NaN. Each row's LAST tab-separated cell is taken, so a
// two-column "Name<TAB>Marks" paste out of Excel works as well as a bare column.
// Trailing blank rows are dropped; interior blanks are preserved so the paste
// stays aligned with the roster.
export function parseMarksPaste(text) {
  if (!text) return []
  const rows = String(text).split(/\r\n|\r|\n/)
  while (rows.length && String(rows[rows.length - 1]).trim() === '') rows.pop()

  return rows.map(row => {
    const cells = String(row).split('\t')
    const raw = String(cells[cells.length - 1] ?? '').trim()
    if (raw === '') return null
    const n = parseFloat(raw)
    return Number.isFinite(n) ? n : null
  })
}

// Turns the grid's { [name]: markValue } map into exam student rows, in roster
// order. A blank (or non-numeric) mark means the student did not appear, so the
// row is omitted entirely — which is what feeds the absentee flagging. An
// explicit 0 is a real mark and is kept.
export function buildOfflineStudentRows(roster, marks) {
  const rows = []
  for (const entry of roster || []) {
    const raw = marks?.[entry.name]
    if (raw === null || raw === undefined || String(raw).trim() === '') continue
    const totalMarks = parseFloat(raw)
    if (!Number.isFinite(totalMarks)) continue
    rows.push({
      name: entry.name,
      rollNo: '',
      totalMarks,
      correct: 0,
      incorrect: 0,
      notAttempted: 0,
      responses: {},
    })
  }
  return rows
}
