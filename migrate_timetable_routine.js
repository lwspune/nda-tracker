// Apply the TT_Prototype_1 daily routine to the four APJ boarding timetables.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node migrate_timetable_routine.js [--dry-run]
//
// RUN migrate_absence_times.js FIRST. Slot rows are retimed in place, and a
// historical absence with no frozen time re-derives it from the slot — so an
// un-backfilled row would silently re-render at the new time.
//
// AFTER RUNNING: every open admin tab must reload. `faculty_state` is a
// whole-blob store; a stale tab's next mutation rewrites the entire object and
// would revert this. The version guard makes that fail loudly rather than
// silently, but only a reload recovers.
//
// Shape change per batch: 15 slots → 18.
//   · morning Self-Study (8:30–9:30) is DROPPED — the new breakfast/CLASS 1
//     window occupies it.
//   · the 4:00–5:00 PM TEACHING slot becomes "Rest"; its subject cells are
//     CLEARED for faculty to re-assign.
//   · 4 new rows: Freshen Up, Clubs/Games/Parade, Tea Time, Lights Out.

import { createClient } from '@supabase/supabase-js'
import { restructureTimetable, allDays, DAYS } from './src/lib/timetableRestructure.js'
import { parseTimeToMinutes } from './src/lib/timetable.js'

const SUPABASE_URL = 'https://exjnzrrlzcrsoxfoojcq.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN      = process.argv.includes('--dry-run')

const SELF_STUDY_MAPPING = 'map_ms7r9iv1'   // "Self-Study" (Sahil Sir)

// Per-batch morning times. Everything from lunch onward is shared.
// The staggered breakfast is the mess sitting order: Arjuna → Karna → 9th/10th.
const MORNING = {
  'APJ_NDA_9th_(26-27)':     { bf: ['8:40 AM', '9:00 AM'], c1: ['9:00 AM', '10:30 AM'], c2: ['10:30 AM', '12:30 PM'] },
  'APJ_NDA_10th_(26-27)':    { bf: ['8:40 AM', '9:00 AM'], c1: ['9:00 AM', '10:30 AM'], c2: ['10:30 AM', '12:30 PM'] },
  'APJ_NDA_11th_(26-27)_B':  { bf: ['8:20 AM', '8:40 AM'], c1: ['9:00 AM', '10:30 AM'], c2: ['10:30 AM', '12:30 PM'] },
  'APJ_NDA_11th_(26-27)_A':  { bf: ['8:00 AM', '8:20 AM'], c1: ['8:30 AM', '10:00 AM'], c2: ['10:00 AM', '12:30 PM'] },
}

// The 15 live slots, in clock order, are the same shape in all four batches.
// Indexes into that sorted list — asserted before use, never assumed.
const FN = {
  PT: 0, FRESHEN: 1, BREAKFAST: 2, SS_MORNING: 3, C1: 4, C2: 5, LUNCH: 6,
  C3: 7, C4: 8, PM_TEACH: 9, EVENING: 10, DINNER: 11, PHONE: 12, ROLL: 13, NIGHT: 14,
}

const WEEKDAYS = DAYS.filter(d => d !== 'Saturday')

// Mon–Fri study, Saturday given over to Personality Classes.
const eveningCells = (asClass) => ({
  ...Object.fromEntries(WEEKDAYS.map(d => [
    d, asClass ? { class: SELF_STUDY_MAPPING } : { break: 'Self Study/Doubts' },
  ])),
  Saturday: { break: 'Personality Classes' },
})

const CLUB_BY_DAY = {
  Monday: 'Clubs', Tuesday: 'Games', Wednesday: 'Parade',
  Thursday: 'Clubs', Friday: 'Games', Saturday: 'Personality Classes',
}

function buildPlan(timetable, sorted) {
  const m = MORNING[timetable.batchName]
  const at = (i) => `${sorted[i].startTime}-${sorted[i].endTime}`
  // The evening block is already an attendance-filed Self-Study class for the
  // 11th batches and a plain break for 9th/10th. Preserved per batch — turning
  // a break into a class would silently oblige teachers to file it.
  const eveningIsClass = Object.values(timetable.grid?.[sorted[FN.EVENING].id] ?? {})
    .some(c => c?.type === 'class')

  return [
    { match: at(FN.PT),        start: '6:30 AM',  end: '7:00 AM',  cells: allDays({ break: 'Wake Up' }) },
    { match: at(FN.FRESHEN),   start: '7:00 AM',  end: '7:30 AM',  cells: allDays({ break: 'Physical Training' }) },
    { match: null,             start: '7:30 AM',  end: '8:00 AM',  cells: allDays({ break: 'Freshen Up' }) },
    { match: at(FN.BREAKFAST), start: m.bf[0],    end: m.bf[1],    cells: allDays({ break: 'Breakfast' }) },
    { match: at(FN.C1),        start: m.c1[0],    end: m.c1[1],    cells: 'keep' },
    { match: at(FN.C2),        start: m.c2[0],    end: m.c2[1],    cells: 'keep' },
    { match: at(FN.LUNCH),     start: '12:30 PM', end: '1:00 PM',  cells: allDays({ break: 'Lunch' }) },
    { match: at(FN.C3),        start: '1:00 PM',  end: '2:30 PM',  cells: 'keep' },
    { match: at(FN.C4),        start: '2:30 PM',  end: '4:00 PM',  cells: 'keep' },
    // Teaching → Rest. Subject cells are dropped here, by design.
    { match: at(FN.PM_TEACH),  start: '4:00 PM',  end: '4:30 PM',  cells: allDays({ break: 'Rest' }) },
    { match: null,             start: '4:30 PM',  end: '5:30 PM',
      cells: Object.fromEntries(DAYS.map(d => [d, { break: CLUB_BY_DAY[d] }])) },
    { match: null,             start: '5:30 PM',  end: '6:00 PM',  cells: allDays({ break: 'Tea Time' }) },
    { match: at(FN.EVENING),   start: '6:00 PM',  end: '8:00 PM',  cells: eveningCells(eveningIsClass) },
    { match: at(FN.DINNER),    start: '8:00 PM',  end: '9:00 PM',  cells: allDays({ break: 'Dinner' }) },
    { match: at(FN.PHONE),     start: '9:00 PM',  end: '9:15 PM',  cells: allDays({ break: 'Phone Call' }) },
    { match: at(FN.ROLL),      start: '9:15 PM',  end: '9:30 PM',  cells: allDays({ break: 'Rounds' }) },
    { match: at(FN.NIGHT),     start: '9:30 PM',  end: '11:30 PM', cells: allDays({ class: SELF_STUDY_MAPPING }) },
    { match: null,             start: '11:30 PM', end: '11:59 PM', cells: allDays({ break: 'Lights Out & Sleep' }) },
  ]
}

// The plan indexes a sorted slot list, so verify that list is the shape we
// think it is before touching anything. A reordered or edited timetable must
// stop the migration, not get silently mis-mapped.
function assertShape(timetable, sorted) {
  const name = timetable.batchName
  if (sorted.length !== 15) {
    throw new Error(`${name}: expected 15 slots, found ${sorted.length} — hand-edited since analysis?`)
  }
  const label = (i) => Object.values(timetable.grid?.[sorted[i].id] ?? {})[0]?.label ?? null
  const expect = (i, want) => {
    const got = label(i)
    if (got !== want) throw new Error(`${name}: slot ${i} expected "${want}", found "${got}"`)
  }
  expect(FN.PT, 'Physical Training')
  expect(FN.FRESHEN, 'Freshen Up')
  expect(FN.BREAKFAST, 'Breakfast')
  expect(FN.LUNCH, 'Lunch')
  expect(FN.DINNER, 'Dinner')
  expect(FN.PHONE, 'Phone Call')
  expect(FN.ROLL, 'Roll Call')
  const isClass = (i) => Object.values(timetable.grid?.[sorted[i].id] ?? {}).some(c => c?.type === 'class')
  for (const i of [FN.SS_MORNING, FN.C1, FN.C2, FN.C3, FN.C4, FN.PM_TEACH, FN.NIGHT]) {
    if (!isClass(i)) throw new Error(`${name}: slot ${i} expected class cells, found none`)
  }
}

function describe(timetable) {
  const sorted = [...timetable.timeSlots].sort(
    (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime))
  return sorted.map(s => {
    const row = timetable.grid?.[s.id] ?? {}
    const kinds = DAYS.map(d => {
      const c = row[d]
      if (!c) return '·'
      return c.type === 'class' ? (c.mappingId === SELF_STUDY_MAPPING ? 'S' : 'C') : 'b'
    }).join('')
    const label = Object.values(row).find(c => c?.type === 'break')?.label ?? ''
    return `    ${(s.startTime + '–' + s.endTime).padEnd(20)} ${kinds}  ${label}`
  }).join('\n')
}

async function main() {
  if (!SERVICE_KEY) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required.')
    process.exit(1)
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: stateRow, error } = await db
    .from('faculty_state').select('data, updated_at').eq('id', 1).single()
  if (error) throw error

  const data = stateRow.data
  const timetables = data.timetables ?? []
  let seq = Date.now()
  const mkId = () => `slot_${(++seq).toString(36)}`

  const next = timetables.map(tt => {
    if (!MORNING[tt.batchName]) return tt
    const sorted = [...tt.timeSlots].sort(
      (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime))
    assertShape(tt, sorted)

    console.log(`\n━━ ${tt.batchName}  (${tt.title ?? ''})`)
    console.log('  BEFORE:'); console.log(describe(tt))
    const out = restructureTimetable(tt, buildPlan(tt, sorted), { mkId })
    console.log('  AFTER:');  console.log(describe(out))

    const kept = out.timeSlots.filter(s => tt.timeSlots.some(o => o.id === s.id)).length
    console.log(`  slots ${tt.timeSlots.length} → ${out.timeSlots.length}  (${kept} reused, ${out.timeSlots.length - kept} new, ${tt.timeSlots.length - kept} dropped)`)
    return out
  })

  const touched = next.filter(t => MORNING[t.batchName]).length
  if (touched !== 4) throw new Error(`Expected to touch 4 timetables, touched ${touched}`)

  console.log('\n  legend: C=class  S=self-study  b=break  ·=empty   (Mon→Sat)')

  if (DRY_RUN) { console.log('\n--dry-run: nothing written.'); return }

  const { data: wrote, error: upErr } = await db
    .from('faculty_state')
    .update({ data: { ...data, timetables: next } })
    .eq('id', 1)
    .eq('updated_at', stateRow.updated_at)   // same guard the app uses
    .select('id')
  if (upErr) throw upErr
  // Zero rows matched = someone saved between our read and our write. Writing
  // unguarded would clobber them; say so instead.
  if (!wrote?.length) {
    throw new Error('conflict: faculty_state changed since it was read. Re-run — nothing was written.')
  }

  console.log('\n✓ Written.')
  console.log('⚠ Every open admin tab must now RELOAD before its next edit.')
}

main().catch(err => {
  console.error('\nMigration failed:', err.message ?? err)
  process.exit(1)
})
