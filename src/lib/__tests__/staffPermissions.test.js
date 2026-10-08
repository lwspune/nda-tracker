import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { STAFF_PERMISSIONS, hasPermission, TIMETABLE_EDIT_KEYS } from '../staffPermissions'
import { hasHostelAccess } from '../teacherDay'

const STAFF = [
  { id: 't1', name: 'Asha Bade Mam', email: 'asha@lwspune.com', timetableAccess: true },
  { id: 't2', name: 'Warden Sir',    email: 'warden@lwspune.com', hostelAccess: true },
  { id: 't3', name: 'Both Sir',      email: 'both@lwspune.com', hostelAccess: true, timetableAccess: true },
  { id: 't4', name: 'No Email Mam',  timetableAccess: true },
]

describe('STAFF_PERMISSIONS registry', () => {
  it('lists hostel and timetable, each with a unique key, field and a label', () => {
    expect(STAFF_PERMISSIONS.map(p => p.key)).toEqual(['hostel', 'timetable'])
    const fields = STAFF_PERMISSIONS.map(p => p.field)
    expect(new Set(fields).size).toBe(fields.length)
    for (const p of STAFF_PERMISSIONS) {
      expect(p.label).toBeTruthy()
      expect(p.description).toBeTruthy()
    }
  })

  // The hostel switch shipped as `hostelAccess` on the teacher record; renaming
  // the field would silently revoke every warden's access.
  it('keeps the shipped hostelAccess field name', () => {
    expect(STAFF_PERMISSIONS.find(p => p.key === 'hostel').field).toBe('hostelAccess')
    expect(STAFF_PERMISSIONS.find(p => p.key === 'timetable').field).toBe('timetableAccess')
  })
})

describe('hasPermission', () => {
  it('grants only the permission the record carries', () => {
    expect(hasPermission(STAFF, 'asha@lwspune.com', 'timetable')).toBe(true)
    expect(hasPermission(STAFF, 'asha@lwspune.com', 'hostel')).toBe(false)
    expect(hasPermission(STAFF, 'warden@lwspune.com', 'timetable')).toBe(false)
    expect(hasPermission(STAFF, 'both@lwspune.com', 'timetable')).toBe(true)
    expect(hasPermission(STAFF, 'both@lwspune.com', 'hostel')).toBe(true)
  })

  it('matches email regardless of case and surrounding whitespace', () => {
    expect(hasPermission(STAFF, '  ASHA@lwspune.com ', 'timetable')).toBe(true)
  })

  it('falls closed on every unidentifiable case', () => {
    expect(hasPermission(STAFF, 'stranger@lwspune.com', 'timetable')).toBe(false)
    expect(hasPermission(STAFF, '', 'timetable')).toBe(false)
    expect(hasPermission(STAFF, null, 'timetable')).toBe(false)
    expect(hasPermission(null, 'asha@lwspune.com', 'timetable')).toBe(false)
    expect(hasPermission([], 'asha@lwspune.com', 'timetable')).toBe(false)
  })

  it('requires a literal true — a truthy string in the JSONB grants nothing', () => {
    expect(hasPermission([{ id: 'x', email: 'a@b.c', timetableAccess: 'yes' }], 'a@b.c', 'timetable')).toBe(false)
    expect(hasPermission([{ id: 'x', email: 'a@b.c', timetableAccess: 1 }], 'a@b.c', 'timetable')).toBe(false)
  })

  // A typo'd key would otherwise deny forever with nothing to say why.
  it('throws on an unknown permission key', () => {
    expect(() => hasPermission(STAFF, 'asha@lwspune.com', 'timetables')).toThrow(/unknown permission/i)
  })

  // hasHostelAccess predates the registry and gates the hostel page + nav; the
  // two must never disagree about who is a warden.
  it('agrees with hasHostelAccess', () => {
    for (const t of STAFF) {
      expect(hasHostelAccess(STAFF, t.email)).toBe(hasPermission(STAFF, t.email, 'hostel'))
    }
  })
})

// The database function is the real boundary; the client only decides what to
// send. These pin the two halves to the same names so a rename on one side
// can't silently open or brick the other.
describe('save_timetable migration agrees with the client', () => {
  const dir = join(process.cwd(), 'supabase', 'migrations')
  const file = readdirSync(dir).find(f => f.endsWith('_create_save_timetable.sql'))
  const sql = file ? readFileSync(join(dir, file), 'utf8') : ''

  it('exists', () => {
    expect(file).toBeTruthy()
  })

  it('accepts exactly the keys the client sends', () => {
    expect(TIMETABLE_EDIT_KEYS).toEqual(['timetables', 'timetableMappings', 'examSchedules'])
    const m = sql.match(/v_allowed\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/i)
    expect(m).toBeTruthy()
    const allowed = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''))
    // Exact equality: the teacher list carries the permission flags, so
    // accepting it would let a teacher grant themselves access.
    expect(allowed).toEqual(TIMETABLE_EDIT_KEYS)
  })

  it('checks the same field the Settings switch writes', () => {
    expect(sql).toContain(`'${STAFF_PERMISSIONS.find(p => p.key === 'timetable').field}'`)
  })

  it('reads the role from app_metadata, never user_metadata', () => {
    const code = sql.replace(/--.*$/gm, '')   // the header comment explains why, by name
    expect(code).toContain("'app_metadata'")
    expect(code).not.toContain('user_metadata')
  })
})
