// Returns students absent on each of the last n non-Sunday dates in the dataset.
// A student is flagged only if they have an 'A' record on ALL n target dates.
export function buildConsecutiveAbsent(records, lwsIdToName, n) {
  if (n < 1 || !records.length) return []

  const allDates = [...new Set(records.map(r => r.date))]
    .filter(d => new Date(d).getDay() !== 0) // exclude Sundays
    .sort((a, b) => b.localeCompare(a))      // latest first

  const targetDates = allDates.slice(0, n)
  if (targetDates.length < n) return []      // not enough data yet

  const targetSet = new Set(targetDates)

  // Build { lws_id: { date: status } } for target dates only
  const byLwsId = {}
  for (const r of records) {
    if (!targetSet.has(r.date)) continue
    if (!byLwsId[r.lws_id]) byLwsId[r.lws_id] = {}
    byLwsId[r.lws_id][r.date] = r.status
  }

  const result = []
  for (const [lwsId, dateMap] of Object.entries(byLwsId)) {
    if (targetDates.every(d => dateMap[d] === 'A')) {
      result.push({
        lwsId,
        name: lwsIdToName[lwsId] || lwsId,
        since: targetDates[targetDates.length - 1], // earliest of n absent dates
      })
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}
