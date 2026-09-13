// Filing a scanned stack into an exam that may already hold results.
//
// ── Why a merge and not a replace ────────────────────────────────────────────
// A stack of paper is not scanned in one sitting. You do thirty sheets, save,
// and come back to the rest — and with a live viewfinder that rhythm gets
// shorter and more frequent, not longer. Writing `{...exam, students}` with only
// THIS session's sheets discards every result filed before it, which for a
// re-scan of two sheets means deleting the other two hundred.
//
// ── Identity ────────────────────────────────────────────────────────────────
// `exam_results` has no student id — `student_name` IS the key, and results are
// filed under whatever the sheet spelled. A scan files the canonical name, so
// matching on the raw string alone would file a student twice whenever their
// earlier result came in under a variant. The roster's `nameVariants` closes
// that, the same way every other surface in this app does.
//
// ── Provenance ──────────────────────────────────────────────────────────────
// `responses` on an Evalbee row is the MACHINE'S verdict and must never be
// re-derived from an answer key; a scanner row is ours and may be. `graded_by`
// is what tells a future re-grade which is which, so it is resolved in the SAFE
// direction: while even one vendor-graded row survives the merge the exam keeps
// the vendor's label, because a re-grade that skips a mixed exam is recoverable
// and one that rewrites Evalbee's marks is not.

import { GRADED_BY_SCANNER, GRADED_BY_VENDOR } from './gradeSheet'

/** A name reduced to what two spellings of the same person share. */
export function nameKey(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Every spelling the roster knows, pointing at one key per student. */
function identityIndex(roster = []) {
  const index = new Map()
  for (const entry of roster) {
    if (!entry) continue
    const id = entry.lwsId || nameKey(entry.name)
    if (!id) continue
    for (const spelling of [entry.name, ...(entry.nameVariants || [])]) {
      const key = nameKey(spelling)
      if (key) index.set(key, id)
    }
  }
  return index
}

/**
 * What saving this stack would do to the exam.
 *
 * @param {object} args
 * @param {object} args.exam      the exam as it stands, `students` included
 * @param {object[]} args.scanned this session's graded rows
 * @param {object[]} args.roster  `buildScanRoster` output, for name variants
 * @returns {{students:object[], added:number, replaced:number, kept:number,
 *            keptVendor:number, gradedBy:string, mixesProvenance:boolean}}
 */
export function planScanSave({ exam, scanned = [], roster = [] } = {}) {
  const existing = exam?.students || []
  const priorGradedBy = exam?.gradedBy || GRADED_BY_VENDOR
  const index = identityIndex(roster)
  // Unresolvable names still key on themselves: a student the roster has never
  // heard of is still the same student across two scans of their sheet.
  const keyOf = row => index.get(nameKey(row?.name)) || nameKey(row?.name)

  const incoming = new Map()
  for (const row of scanned) incoming.set(keyOf(row), row)

  const students = []
  const usedKeys = new Set()
  let replaced = 0, keptVendor = 0
  for (const row of existing) {
    const key = keyOf(row)
    const scan = incoming.get(key)
    if (scan) {
      // In place: the exam's result order is what every export and report reads.
      students.push(scan)
      usedKeys.add(key)
      replaced++
    } else {
      students.push(row)
      if (priorGradedBy !== GRADED_BY_SCANNER) keptVendor++
    }
  }
  for (const [key, row] of incoming) {
    if (!usedKeys.has(key)) students.push(row)
  }

  return {
    students,
    added: students.length - existing.length,
    replaced,
    kept: existing.length - replaced,
    keptVendor,
    gradedBy: keptVendor > 0 ? priorGradedBy : GRADED_BY_SCANNER,
    // Worth a human's explicit yes: the exam's marks will no longer all come
    // from one grader.
    mixesProvenance: priorGradedBy !== GRADED_BY_SCANNER && existing.length > 0,
  }
}
