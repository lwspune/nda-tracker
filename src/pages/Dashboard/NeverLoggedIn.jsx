import { useEffect, useState } from 'react'
import { Card, CardTitle, Badge } from '../../components/ui'
import { buildNeverLoggedIn } from '../../lib/analytics/portalAdoption'

// Dashboard "never logged in" — active students who have never opened the student
// portal. Class-wide and Active-only (ignores the page's subject/branch/batch
// filter chain, like the attendance roll-up). Fetch-on-demand; not stored.
//
// The card stays mounted even when the list is empty: a chase list that vanishes
// cannot distinguish "everyone has logged in" from "nothing loaded".
//
// `loginIds === null` means the read failed or there is no session — we show an
// unavailable state rather than a list, because treating it as "nobody has ever
// logged in" would flag the entire roster.

function batchLabel(batches) {
  if (!batches?.length) return 'no batch'
  return batches.join(', ')
}

export default function NeverLoggedIn({ studentProfiles, fetchStudentLoginIds, setActiveStudent }) {
  const [loginIds, setLoginIds] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (typeof fetchStudentLoginIds !== 'function') return
    let cancelled = false
    fetchStudentLoginIds().then(ids => {
      if (cancelled) return
      setLoginIds(ids)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [fetchStudentLoginIds])

  const rows = loginIds ? buildNeverLoggedIn({ loginIds, studentProfiles }) : []
  const unavailable = loaded && loginIds === null

  return (
    <div className="mb-4 md:mb-5">
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>🔑 Never Logged In</CardTitle>
          {loginIds && (
            <span data-testid="never-count">
              <Badge variant={rows.length ? 'red' : 'green'}>{rows.length}</Badge>
            </span>
          )}
        </div>

        <p className="text-[11px] text-ink-3 mb-2">
          Active students who have never opened the student portal. Longest-enrolled first.
        </p>

        {!loaded && (
          <p className="text-[12px] text-ink-3 py-3">Loading…</p>
        )}

        {unavailable && (
          <p className="text-[12px] text-ink-3 py-3" data-testid="never-unavailable">
            Portal login history is unavailable right now, so this list cannot be built.
          </p>
        )}

        {loaded && loginIds && rows.length === 0 && (
          <p className="text-[12px] text-ink-3 py-3" data-testid="never-empty">
            Every active student has logged in at least once.
          </p>
        )}

        {rows.length > 0 && (
          <div className="flex flex-col divide-y divide-border">
            {rows.map(s => (
              <button
                key={s.lwsId}
                type="button"
                onClick={() => setActiveStudent?.(s.name)}
                className="flex items-center justify-between gap-2 py-2 text-left hover:bg-surface-2 rounded
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={`Open ${s.name} — never logged in`}
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-ink truncate">
                    {s.name}
                    {s.contactCount === 0 && (
                      <span
                        data-testid={`no-contact-${s.lwsId}`}
                        title="No mobile and no parent number on file — the portal logs in by mobile number, so this student cannot sign in at all."
                        className="ml-2 align-middle text-[10px] font-semibold text-red-600 border border-red-600 rounded px-1 py-[1px]"
                      >
                        no number on file
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-ink-3 truncate">
                    {batchLabel(s.batches)}
                  </div>
                </div>
                {s.daysEnrolled !== null && (
                  <Badge variant="yellow">{s.daysEnrolled}d enrolled</Badge>
                )}
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
