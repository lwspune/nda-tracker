// Single source of truth for "is this contact blocked?" — used by every WhatsApp
// send path so a blocked / quit / inactive student is never messaged.
//
// This mirrors the login gate (api/student-login.js INACTIVE_STATUSES): only the
// explicit Block / Quit / Inactive statuses are excluded; blank/legacy status is
// treated as active (fail open), so a student who was never stamped 'Active' is
// not silently dropped from notifications. (Analytics elsewhere use the stricter
// `=== 'Active'`; sending mirrors login, not analytics — see DECISIONS.md.)

export const INACTIVE_STATUSES = new Set(['Block', 'Quit', 'Inactive'])

// Raw status string (either the snake_case `account_status` from Supabase or the
// camelCase `accountStatus` from studentProfiles — pass the value, not the row).
export function isBlockedStatus(status) {
  return INACTIVE_STATUSES.has(String(status ?? '').trim())
}

// Convenience for a camelCase studentProfiles row. A missing profile is treated
// as active (defensive — the caller decides separately whether to keep it).
export function isActiveContact(profile) {
  return !isBlockedStatus(profile?.accountStatus)
}
