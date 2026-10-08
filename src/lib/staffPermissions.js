import { findTeacherByEmail } from './teacherDay'

// Per-person permissions for staff accounts, switched on and off in
// Settings → Teachers. Each one is a boolean field on the TEACHER RECORD
// (`timetableTeachers[]` in faculty_state), not a new auth role: every
// permission gate in this codebase is a deny-list on role='teacher', so a new
// role would silently inherit ADMIN defaults at all of them (see
// lib/teacherDay.js hasHostelAccess). Admin accounts need none of these — they
// can already do everything.
//
// Teachers cannot grant themselves anything: faculty_state's write policies
// exclude role='teacher', and save_timetable refuses the teacher list.
//
// A new permission is: one entry here (the Settings switch, the slice's patch
// allow-list and the row badge all read this list) + whatever gate it opens.
// `hostelAccess` keeps the field name it shipped with — renaming it would
// silently revoke every warden.
export const STAFF_PERMISSIONS = [
  {
    key: 'hostel',
    field: 'hostelAccess',
    label: 'Hostel & mess attendance',
    description: 'Opens the hostel & mess capture page for APJ boarders.',
    badge: '🏠 hostel & mess',
  },
  {
    key: 'timetable',
    field: 'timetableAccess',
    label: 'Edit timetable',
    description: 'Cells, mappings, new time slots, notes and the exam schedule. Cannot retime or delete an existing slot, or create, rename or delete a timetable.',
    badge: '🗓 edits timetable',
  },
]

const BY_KEY = Object.fromEntries(STAFF_PERMISSIONS.map(p => [p.key, p]))

// Whether the signed-in staff member holds `key`. Falls closed on every
// unidentifiable case and requires a literal `true`, so a stray truthy value
// in the JSONB grants nothing. An unknown key throws: a typo would otherwise
// deny forever with nothing to say why.
export function hasPermission(teachers, email, key) {
  const perm = BY_KEY[key]
  if (!perm) throw new Error(`Unknown permission "${key}"`)
  return findTeacherByEmail(teachers, email)?.[perm.field] === true
}

// The faculty_state keys a teacher with the timetable permission may write,
// via the save_timetable database function (supabase/migrations/*_create_save_timetable.sql).
// The function holds the same list and is the actual boundary; a test pins the two together.
export const TIMETABLE_EDIT_KEYS = ['timetables', 'timetableMappings', 'examSchedules']
