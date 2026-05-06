// ── Main merge function ───────────────────────────────────────
import { nextLwsId } from './lwsHelpers'

// Fields updated from Excel for an existing student
const UPDATABLE_FIELDS = ['mobile', 'email', 'branch', 'coming_status', 'account_status', 'quit_date']

/**
 * Merges imported Excel rows into the existing students array.
 *
 * Match key: eis_reg_no (EIS RegistrationNo.)
 *
 * Existing student:
 *   - Updates UPDATABLE_FIELDS when the Excel value is non-empty and differs
 *   - Merges the Excel batch into batches[] (no duplicates)
 *   - Adds canonical_name to name_variants[] if not already present
 *
 * New student (no eis_reg_no match):
 *   - Assigns the next LWS ID
 *   - Initialises attendance/exams/fees/evalbee_roll_nos as empty
 *
 * @param {Array} existingStudents  - students array from students_db.json
 * @param {Array} importedRows      - output of parseStudentsExcel()
 * @returns {{ students: Array, added: number, updated: number, unchanged: number }}
 */
export function mergeStudents(existingStudents, importedRows) {
  const students = existingStudents.map(s => ({ ...s }))

  // Build index: eis_reg_no → position in students[]
  const byEisRegNo = {}
  students.forEach((s, i) => {
    if (s.eis_reg_no) byEisRegNo[String(s.eis_reg_no).trim()] = i
  })

  let added = 0, updated = 0, unchanged = 0

  for (const row of importedRows) {
    const eisKey = String(row.eis_reg_no || '').trim()
    if (!eisKey) continue   // rows without a registration number are skipped

    const existingIdx = byEisRegNo[eisKey]

    if (existingIdx !== undefined) {
      // ── Update existing student ──────────────────────────
      const s = students[existingIdx]
      let changed = false

      for (const field of UPDATABLE_FIELDS) {
        const newVal = row[field]
        if (newVal !== undefined && newVal !== null && newVal !== '' && newVal !== s[field]) {
          s[field] = newVal
          changed = true
        }
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

      // Merge guardian mobile into parent_mobiles[] — never overwrites manually-added numbers
      const gMobile = (row.guardian_mobile || '').trim()
      if (gMobile && !(s.parent_mobiles || []).includes(gMobile)) {
        s.parent_mobiles = [...(s.parent_mobiles || []), gMobile]
        changed = true
      }

      if (changed) updated++
      else unchanged++

    } else {
      // ── Add new student ──────────────────────────────────
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
      byEisRegNo[eisKey] = students.length - 1
      added++
    }
  }

  return { students, added, updated, unchanged }
}
