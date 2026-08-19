// Rebuild a timetable's slot rows + grid from a routine plan.
//
// Used by migrate_timetable_routine.js to apply a new daily routine to an
// existing timetable without detaching what hangs off it.
//
// THE RULE: a slot that survives keeps its id. Grid cells key off slotId, and
// so do `lecture_absences`, `lecture_submissions` and
// `teacher_calendar_blocks.block_key`. Recreating a slot at the same clock time
// silently orphans every subject assignment and every attendance record filed
// against it. Reuse is correctness, not an optimisation.
//
// A plan row:
//   {
//     match: '9:30 AM-10:50 AM' | null,   // existing slot to reuse, by current time
//     start: '9:00 AM', end: '10:30 AM',  // the new clock time
//     cells: 'keep' | { <Day>: { break: 'Label' } | { class: 'map_id' } },
//   }
//
// `cells: 'keep'` preserves the existing grid row verbatim — that is what
// carries a teaching slot's subjects through a retime. Anything else REPLACES
// the row outright, which is how a teaching slot becomes a break.
//
// Pure: returns a new timetable, never mutates the input.

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Sugar for the common "same thing every day" row.
export function allDays(spec) {
  return Object.fromEntries(DAYS.map(d => [d, spec]))
}

const timeKey = (slot) => `${slot.startTime}-${slot.endTime}`

function toCell(spec) {
  if (!spec) return null
  if (spec.class) return { type: 'class', mappingId: spec.class }
  return { type: 'break', label: spec.break ?? '' }
}

export function restructureTimetable(timetable, plan, { mkId } = {}) {
  if (typeof mkId !== 'function') throw new Error('restructureTimetable: mkId is required')

  const bySlotTime = new Map()
  for (const slot of timetable?.timeSlots ?? []) bySlotTime.set(timeKey(slot), slot)

  const claimed = new Set()
  const timeSlots = []
  const grid = {}

  for (const row of plan ?? []) {
    let slotId
    if (row.match) {
      const existing = bySlotTime.get(row.match)
      // Fail loud. A typo'd match would otherwise mint a new slot and quietly
      // strand the real one's subjects and attendance history.
      if (!existing) {
        throw new Error(
          `restructureTimetable: no slot at "${row.match}" in ${timetable?.batchName ?? '(unnamed)'}`,
        )
      }
      if (claimed.has(existing.id)) {
        throw new Error(`restructureTimetable: slot "${row.match}" matched twice`)
      }
      claimed.add(existing.id)
      slotId = existing.id
    } else {
      slotId = mkId()
    }

    timeSlots.push({ id: slotId, startTime: row.start, endTime: row.end })

    if (row.cells === 'keep') {
      // Shallow-copy the row so the caller's grid is never aliased.
      grid[slotId] = { ...(timetable?.grid?.[slotId] ?? {}) }
      continue
    }

    const next = {}
    for (const [day, spec] of Object.entries(row.cells ?? {})) {
      const cell = toCell(spec)
      if (cell) next[day] = cell
    }
    grid[slotId] = next
  }

  // Slots absent from the plan are dropped, and their grid rows with them —
  // leaving a row behind would resurrect it on the next save.
  return { ...timetable, timeSlots, grid }
}
