// ── The score carried by the WhatsApp result message ─────────────────────────
// Single source for the three score values in the result template:
//   Score: <pct>%  ·  Correct Qs: <scored>  ·  Total Qs: <outOf>
//
// Both `api/send-whatsapp.js` (which sends them) and `WhatsAppPreviewModal`
// (which shows them before you press send) call this. That shared call is what
// makes the preview a cross-check: two formulas would agree today and drift
// later, and a preview that vouches for a number the parent never receives is
// worse than no preview at all.
//
// Why the offline branch exists: an offline / hand-graded exam has no
// questions[], so every result row's correct/incorrect/notAttempted is 0 and
// the marks live in totalMarks. Scoring those off the counters yields 0/0 and
// messaged 13 families "Score: 0%, Correct Qs: 0, Total Qs: 0" (2026-07-28).
//
// Callers hold different shapes — the endpoint reads raw snake_case Supabase
// rows, the modal reads the camelCase store objects — so each maps at its own
// edge and the arithmetic stays here.

// Extension is REQUIRED: this module is reachable from api/send-whatsapp.js,
// which runs under Node's ESM loader on Vercel. Bundler resolution (Vite,
// Vitest) accepts the bare specifier; Node does not, and the function then
// dies at module load with ERR_MODULE_NOT_FOUND before the handler runs.
// Guarded by api/__tests__/importGraph.test.js.
import { examMaxMarks } from './analyticsHelpers.js'

/**
 * Per-exam scoring context. Compute once per exam, reuse for every row.
 * @param {{questions?: any[], marking?: object, maxMarks?: number|string|null}} exam
 *        camelCase — snake_case callers must map `max_marks` → `maxMarks` first.
 * @returns {{isOffline: boolean, maxMarks: number}}
 */
export function examScoreBasis(exam) {
  return {
    // Offline-ness is derived, never stored — same rule as every other reader.
    isOffline: !exam?.questions?.length,
    maxMarks:  examMaxMarks(exam),
  }
}

/**
 * The three template values for one result row.
 * @param {{isOffline: boolean, maxMarks: number}} basis from examScoreBasis
 * @param {{totalMarks?: number|string, correct?: number, incorrect?: number, notAttempted?: number}} row
 * @returns {{pct: number, scored: number, outOf: number}} pct is a whole number
 */
export function resultScore(basis, row) {
  let scored, outOf
  if (basis.isOffline) {
    scored = Number(row?.totalMarks) || 0
    outOf  = basis.maxMarks
  } else {
    const correct   = row?.correct      || 0
    const incorrect = row?.incorrect    || 0
    const skipped   = row?.notAttempted || 0
    scored = correct
    outOf  = correct + incorrect + skipped
  }
  return { pct: outOf ? Math.round(scored / outOf * 100) : 0, scored, outOf }
}
