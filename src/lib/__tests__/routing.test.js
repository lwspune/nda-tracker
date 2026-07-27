import { describe, it, expect } from 'vitest'
import { isSchoolAttendancePath } from '../routing'

// vercel.json rewrites every non-api path to index.html, so the app boots on
// /school-attendance; this helper is what gives the URL meaning. BASE_URL is
// '/' on Vercel and '/nda-tracker/' on the legacy GitHub Pages build.
describe('isSchoolAttendancePath', () => {
  it('matches the path on the Vercel base', () => {
    expect(isSchoolAttendancePath('/school-attendance', '/')).toBe(true)
    expect(isSchoolAttendancePath('/school-attendance/', '/')).toBe(true)
  })

  it('matches under the GitHub Pages base prefix', () => {
    expect(isSchoolAttendancePath('/nda-tracker/school-attendance', '/nda-tracker/')).toBe(true)
    expect(isSchoolAttendancePath('/nda-tracker/school-attendance/', '/nda-tracker/')).toBe(true)
  })

  it('does not match the root, other pages, or a lookalike prefix', () => {
    expect(isSchoolAttendancePath('/', '/')).toBe(false)
    expect(isSchoolAttendancePath('/attendance', '/')).toBe(false)
    expect(isSchoolAttendancePath('/school-attendance-old', '/')).toBe(false)
    expect(isSchoolAttendancePath('/hostel-attendance', '/')).toBe(false)
  })

  it('defaults the base to / and tolerates a missing pathname', () => {
    expect(isSchoolAttendancePath('/school-attendance')).toBe(true)
    expect(isSchoolAttendancePath(undefined)).toBe(false)
    expect(isSchoolAttendancePath('')).toBe(false)
  })
})
