// Returns students whose consecutive-absence streak — walking the global
// non-Sunday date sequence backwards from the latest known date — is >= n.
// A streak is broken by the first 'P', 'L', or missing record.
// `since` is the earliest 'A' in the actual streak (may go back further than n).
// `count` is the streak length — recorded non-Sunday days marked 'A'.
export function buildConsecutiveAbsent(records, lwsIdToName, n) {
  if (n < 1 || !records.length) return []

  const allDates = [...new Set(records.map(r => r.date))]
    .filter(d => new Date(d).getDay() !== 0) // exclude Sundays
    .sort((a, b) => b.localeCompare(a))      // latest first

  if (allDates.length < n) return []         // not enough non-Sunday data yet

  // { lws_id: { date: status } } over all records. Sunday rows are harmless —
  // never queried because allDates excludes them.
  const byLwsId = {}
  for (const r of records) {
    if (!byLwsId[r.lws_id]) byLwsId[r.lws_id] = {}
    byLwsId[r.lws_id][r.date] = r.status
  }

  const result = []
  for (const [lwsId, dateMap] of Object.entries(byLwsId)) {
    let streak = 0
    let since = null
    for (const d of allDates) {              // latest → oldest
      if (dateMap[d] === 'A') {
        streak++
        since = d                            // earliest A so far in the streak
      } else {
        break                                // P / L / missing record ⇒ stop
      }
    }
    if (streak >= n) {
      result.push({
        lwsId,
        name: lwsIdToName[lwsId] || lwsId,
        since,
        count: streak,         // recorded non-Sunday absent days in the streak
      })
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}
