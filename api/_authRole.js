// The single server-side reader of the auth role claim.
//
// Twin of src/lib/authRole.js — same rule, different input shape: the endpoints
// hold a `user` from `supabase.auth.getUser(bearer)`, not a session.
//
// The claim lives in `app_metadata`, NEVER `user_metadata` (moved 2026-09-10).
// `user_metadata` is writable by the account holder via
// `supabase.auth.updateUser({ data: { role: ... } })`, so a teacher could
// relabel themselves and walk through the 403s below. `app_metadata` is
// Admin-API-only. There is deliberately no fallback — see the client twin.
//
// Underscore-prefixed: Vercel does not count it against the 12-function Hobby
// cap, but api/__tests__/importGraph.test.js still walks it, so relative imports
// here need their file extensions.

export function userRole(user) {
  return user?.app_metadata?.role ?? null
}

export function isTeacherUser(user) {
  return userRole(user) === 'teacher'
}

export function isSuperadminUser(user) {
  return userRole(user) === 'superadmin'
}
