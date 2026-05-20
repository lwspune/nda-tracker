// ── Main merge function ───────────────────────────────────────
import { nextLwsId } from './lwsHelpers'

// Fields updated from Excel for an existing student
const UPDATABLE_FIELDS = ['mobile', 'email', 'branch', 'coming_status', 'account_status', 'quit_date']

function trimStr(v) {
  return String(v ?? '').trim()
}

function candidateOf(s) {
  return {
    lws_id:         s.lws_id,
    canonical_name: s.canonical_name,
    mobile:         s.mobile,
    branch:         s.branch,
  }
}

/**
 * Merges imported Excel rows into the existing students array.
 *
 * Match (tiered — each step requires "exactly one" unambiguous hit):
 *   1. eis_reg_no
 *   2. mobile  (non-empty, exactly one existing student with that mobile)
 *   3. canonical_name + branch  (both non-empty, exact match, exactly one hit)
 *
 * Existing student (matched at any step):
 *   - Updates UPDATABLE_FIELDS (and eis_reg_no when matched via steps 2/3) when
 *     the Excel value is non-empty and differs
 *   - Merges the Excel batch into batches[] (no duplicates)
 *   - Adds canonical_name to name_variants[] if not already present
 *   - Appends guardian_mobile to parent_mobiles[] (no duplicates)
 *
 * No match:
 *   - With non-empty EIS → insert as new
 *   - With blank EIS → skip (preserves the safety net: don't create students
 *     without an EIS, since EIS is the canonical identifier)
 *
 * Conflict reporting (returned in `conflicts[]`):
 *   - ambiguous_mobile          step 2 found 2+ candidates
 *   - ambiguous_name_branch     step 3 found 2+ candidates
 *   - mobile_conflict_on_eis_match  EIS matched, but new mobile != existing non-empty mobile
 *
 * @param {Array} existingStudents - students array from students_db.json
 * @param {Array} importedRows     - output of parseStudentsExcel()
 * @returns {{ students: Array, added: number, updated: number, unchanged: number, conflicts: Array }}
 */
export function mergeStudents(existingStudents, importedRows) {
  const students = existingStudents.map(s => ({ ...s }))

  // Build indices
  const byEisRegNo  = {}             // eis → position
  const byMobile    = {}             // mobile → [positions]
  const byNameBranch = {}            // 'lowername|branch' → [positions]

  students.forEach((s, i) => {
    const eis = trimStr(s.eis_reg_no)
    if (eis) byEisRegNo[eis] = i

    const mob = trimStr(s.mobile)
    if (mob) (byMobile[mob] = byMobile[mob] || []).push(i)

    const name = trimStr(s.canonical_name).toLowerCase()
    const branch = trimStr(s.branch)
    if (name && branch) {
      const key = name + '|' + branch
      ;(byNameBranch[key] = byNameBranch[key] || []).push(i)
    }
  })

  let added = 0, updated = 0, unchanged = 0
  const conflicts = []

  for (const row of importedRows) {
    const eisKey = trimStr(row.eis_reg_no)
    const mobKey = trimStr(row.mobile)
    const nameKey = trimStr(row.canonical_name).toLowerCase()
    const branchKey = trimStr(row.branch)

    let existingIdx
    let matchedBy   // 'eis' | 'mobile' | 'name_branch' | undefined

    // Step 1: EIS
    if (eisKey && byEisRegNo[eisKey] !== undefined) {
      existingIdx = byEisRegNo[eisKey]
      matchedBy = 'eis'
    }

    // Step 2: mobile
    if (existingIdx === undefined && mobKey) {
      const hits = byMobile[mobKey] || []
      if (hits.length === 1) {
        existingIdx = hits[0]
        matchedBy = 'mobile'
      } else if (hits.length > 1) {
        conflicts.push({
          row,
          reason: 'ambiguous_mobile',
          candidates: hits.map(i => candidateOf(students[i])),
        })
      }
    }

    // Step 3: name + branch
    if (existingIdx === undefined && nameKey && branchKey) {
      const key = nameKey + '|' + branchKey
      const hits = byNameBranch[key] || []
      if (hits.length === 1) {
        existingIdx = hits[0]
        matchedBy = 'name_branch'
      } else if (hits.length > 1) {
        conflicts.push({
          row,
          reason: 'ambiguous_name_branch',
          candidates: hits.map(i => candidateOf(students[i])),
        })
      }
    }

    if (existingIdx !== undefined) {
      // ── Update existing student ──────────────────────────
      const s = students[existingIdx]
      let changed = false

      // Mobile conflict surfaced when EIS matched but mobile genuinely differs.
      // Doesn't block the update — EIS wins by contract — but lets faculty see
      // that the row may represent a different person sharing the EIS.
      if (matchedBy === 'eis') {
        const oldMobile = trimStr(s.mobile)
        if (oldMobile && mobKey && oldMobile !== mobKey) {
          conflicts.push({
            row,
            reason: 'mobile_conflict_on_eis_match',
            candidates: [candidateOf(s)],
          })
        }
      }

      for (const field of UPDATABLE_FIELDS) {
        const newVal = row[field]
        if (newVal !== undefined && newVal !== null && newVal !== '' && newVal !== s[field]) {
          s[field] = newVal
          changed = true
        }
      }

      // If matched via mobile or name+branch, pull eis_reg_no in too
      if (matchedBy !== 'eis' && eisKey && eisKey !== trimStr(s.eis_reg_no)) {
        s.eis_reg_no = eisKey
        // Keep the index in sync so a later row with the same EIS still matches
        byEisRegNo[eisKey] = existingIdx
        changed = true
      }

      // Merge batch (no duplicates)
      const newBatch = row.batches?.[0]
      if (newBatch && !(s.batches || []).includes(newBatch)) {
        s.batches = [...(s.batches || []), newBatch]
        changed = true
      }

      // Merge name variant (no duplicates)
      const newName = row.canonical_name
      if (newName && !(s.name_variants || []).includes(newName)) {
        s.name_variants = [...(s.name_variants || []), newName]
        changed = true
      }

      // Merge guardian mobile (never overwrites manually-added numbers)
      const gMobile = trimStr(row.guardian_mobile)
      if (gMobile && !(s.parent_mobiles || []).includes(gMobile)) {
        s.parent_mobiles = [...(s.parent_mobiles || []), gMobile]
        changed = true
      }

      if (changed) updated++
      else unchanged++

    } else {
      // ── No match: insert as new only if EIS is non-empty ─
      if (!eisKey) continue   // no usable identifier → skip

      const lws_id = nextLwsId(students)

      const newStudent = {
        lws_id,
        canonical_name:    row.canonical_name,
        mobile:            row.mobile            || '',
        dob:               row.dob               || null,
        gender:            row.gender             || '',
        email:             row.email              || '',
        eis_reg_no:        eisKey,
        registration_date: row.registration_date  || null,
        batches:           row.batches            || [],
        branch:            row.branch             || '',
        account_status:    row.account_status     || '',
        coming_status:     row.coming_status      || '',
        quit_date:         row.quit_date          || null,
        parent_mobiles:    row.guardian_mobile ? [row.guardian_mobile] : [],
        name_variants:     row.canonical_name ? [row.canonical_name] : [],
        evalbee_roll_nos:  [],
        match_signatures:  [
          row.canonical_name?.toLowerCase(),
          row.mobile,
          eisKey,
        ].filter(Boolean),
        attendance: [],
        exams:      [],
        fees:       {},
      }

      students.push(newStudent)
      const newIdx = students.length - 1
      byEisRegNo[eisKey] = newIdx
      if (mobKey) (byMobile[mobKey] = byMobile[mobKey] || []).push(newIdx)
      if (nameKey && branchKey) {
        const key = nameKey + '|' + branchKey
        ;(byNameBranch[key] = byNameBranch[key] || []).push(newIdx)
      }
      added++
    }
  }

  return { students, added, updated, unchanged, conflicts }
}
