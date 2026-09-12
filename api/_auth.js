// The MECHANICAL half of the auth preamble every admin endpoint repeats.
//
// Deliberately NOT a `requireAdminSession()`. The nine doors in api/ are not
// the same door: send-attendance-alerts and send-mentor-nudges accept a
// CRON_SECRET instead of a session, quiz-import has two shared-secret paths
// checked before the session path, and teacher-account layers admin-API powers
// on top. A helper that swallowed all that would hide WHICH callers refuse a
// teacher — and on 2026-09-12 the answer turned out to be "all but one":
// send-whatsapp.js, the endpoint that sends exam results to parents, had no
// teacher check at all. Nine near-identical blocks are what hid it.
//
// So only the two genuinely mechanical steps live here. Each endpoint keeps its
// own 401s, its own 403, and its own wording, inline and greppable.
//
// Underscore-prefixed: Vercel does not count it against the 12-function Hobby
// cap, but api/__tests__/importGraph.test.js still walks it, so relative
// imports here need their file extensions.

/** The token from an `Authorization: Bearer <jwt>` header, or ''. */
export function bearerFrom(req) {
  return (req?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim()
}

/**
 * Resolve a token to a Supabase user, or null.
 *
 * Never throws. The nine inline copies all wrote
 * `const { data: { user } } = await client.auth.getUser(jwt)`, which throws on a
 * rejected call or a bodyless response — an unhandled rejection instead of a
 * refusal. Returning null routes every one of those cases into the caller's
 * existing `if (!user) -> 401`, which fails closed.
 */
export async function getUserOrNull(client, jwt) {
  if (!jwt) return null
  try {
    const { data, error } = await client.auth.getUser(jwt)
    if (error) return null
    return data?.user ?? null
  } catch {
    return null
  }
}
