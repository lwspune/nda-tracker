import { describe, it, expect } from 'vitest'
import {
  isSchoolAttendancePath, isHostelAttendancePath, buildCaptureUrl,
  SCHOOL_ATTENDANCE_PATH, HOSTEL_ATTENDANCE_PATH,
} from '../routing'

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

describe('isHostelAttendancePath', () => {
  it('matches on both deploy bases, with and without a trailing slash', () => {
    expect(isHostelAttendancePath('/hostel-mess-attendance', '/')).toBe(true)
    expect(isHostelAttendancePath('/hostel-mess-attendance/', '/')).toBe(true)
    expect(isHostelAttendancePath('/nda-tracker/hostel-mess-attendance', '/nda-tracker/')).toBe(true)
  })

  it('does not collide with the school-attendance route or lookalikes', () => {
    expect(isHostelAttendancePath('/school-attendance', '/')).toBe(false)
    expect(isHostelAttendancePath('/hostel-mess', '/')).toBe(false)
    expect(isHostelAttendancePath('/', '/')).toBe(false)
    expect(isSchoolAttendancePath('/hostel-mess-attendance', '/')).toBe(false)
  })
})

// The link faculty hand to a teacher. The base prefix is the whole reason this
// isn't a string template at the call site: on the GitHub Pages build a link
// built without it 404s, and it would do so silently.
describe('buildCaptureUrl', () => {
  it('joins origin + path on the Vercel base', () => {
    expect(buildCaptureUrl(SCHOOL_ATTENDANCE_PATH, 'https://nda-tracker.vercel.app', '/'))
      .toBe('https://nda-tracker.vercel.app/school-attendance')
    expect(buildCaptureUrl(HOSTEL_ATTENDANCE_PATH, 'https://nda-tracker.vercel.app', '/'))
      .toBe('https://nda-tracker.vercel.app/hostel-mess-attendance')
  })

  it('keeps the GitHub Pages base prefix', () => {
    expect(buildCaptureUrl(SCHOOL_ATTENDANCE_PATH, 'https://lwspune.github.io', '/nda-tracker/'))
      .toBe('https://lwspune.github.io/nda-tracker/school-attendance')
  })

  it('never emits a doubled slash, whatever the base looks like', () => {
    expect(buildCaptureUrl(SCHOOL_ATTENDANCE_PATH, 'https://x.dev/', '/'))
      .toBe('https://x.dev/school-attendance')
    expect(buildCaptureUrl(SCHOOL_ATTENDANCE_PATH, 'https://x.dev', '/nda-tracker'))
      .toBe('https://x.dev/nda-tracker/school-attendance')
  })

  it('round-trips through the matcher — the link it builds is one the app recognises', () => {
    const url = buildCaptureUrl(HOSTEL_ATTENDANCE_PATH, 'https://lwspune.github.io', '/nda-tracker/')
    expect(isHostelAttendancePath(new URL(url).pathname, '/nda-tracker/')).toBe(true)
  })

  it('tolerates a missing origin/base rather than emitting "undefined"', () => {
    expect(buildCaptureUrl(SCHOOL_ATTENDANCE_PATH, '', '')).toBe('/school-attendance')
    expect(buildCaptureUrl(SCHOOL_ATTENDANCE_PATH)).toBe('/school-attendance')
  })
})
