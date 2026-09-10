// The single client-side reader of the auth role claim.
//
// The claim lives in `app_metadata`, NEVER `user_metadata` (moved 2026-09-10).
// `user_metadata` is writable by the account holder — any signed-in user can run
//   supabase.auth.updateUser({ data: { role: 'superadmin' } })
// and relabel themselves. Every gate keyed on it (the teacher deny-lists, the
// teacher_feedback boundary) was therefore defeatable by exactly the accounts it
// restricted. `app_metadata` is settable only through the Admin API, i.e. only
// with the service-role key, which never reaches a browser.
//
// Deliberately NO fallback to user_metadata: a fallback reinstates the spoof for
// any session that simply omits app_metadata. Sessions minted before the
// migration were invalidated by a global sign-out, so there is nothing to fall
// back for. See src/lib/__tests__/authRole.test.js and SECURITY.md.
//
// Server-side twin (same rule, `user` instead of `session`): api/_authRole.js.

export function sessionRole(session) {
  return session?.user?.app_metadata?.role ?? null
}

export function isTeacherSession(session) {
  return sessionRole(session) === 'teacher'
}

export function isSuperadminSession(session) {
  return sessionRole(session) === 'superadmin'
}
