import { describe, it, expect } from 'vitest'
import { restructureTimetable, allDays } from '../timetableRestructure'

// Rebuilding a timetable from a routine spec, in place.
//
// The load-bearing rule: a slot that survives KEEPS ITS ID. Grid cells key off
// slotId, and so do lecture_absences / lecture_submissions / calendar blocks —
// so recreating a slot silently detaches every subject assignment and every
// attendance record filed against it. Reuse is not an optimisation here.

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const liveTimetable = () => ({
  id: 'tt_1',
  branch: 'APJ',
  batchName: 'TEST_BATCH',
  timeSlots: [
    { id: 'slot_pt',    startTime: '6:30 AM',  endTime: '7:00 AM' },
    { id: 'slot_fresh', startTime: '7:00 AM',  endTime: '8:00 AM' },
    { id: 'slot_ss_am', startTime: '8:30 AM',  endTime: '9:30 AM' },
    { id: 'slot_c1',    startTime: '9:30 AM',  endTime: '10:50 AM' },
    { id: 'slot_pm',    startTime: '4:00 PM',  endTime: '5:00 PM' },
  ],
  grid: {
    slot_pt:    Object.fromEntries(DAYS.map(d => [d, { type: 'break', label: 'Physical Training' }])),
    slot_fresh: Object.fromEntries(DAYS.map(d => [d, { type: 'break', label: 'Freshen Up' }])),
    slot_ss_am: Object.fromEntries(DAYS.map(d => [d, { type: 'class', mappingId: 'map_ss' }])),
    slot_c1:    { Monday: { type: 'class', mappingId: 'map_maths' },
                  Tuesday: { type: 'class', mappingId: 'map_phy' } },
    slot_pm:    { Monday: { type: 'class', mappingId: 'map_chem' },
                  Saturday: { type: 'break', label: 'Hi-Tea/Sports' } },
  },
})

// Deterministic id minting so assertions can name the new slots.
const mkId = (() => { let n = 0; return () => `slot_new${++n}` })

describe('restructureTimetable', () => {
  it('reuses the matched slot id so grid cells and history stay attached', () => {
    const out = restructureTimetable(liveTimetable(), [
      { match: '9:30 AM-10:50 AM', start: '9:00 AM', end: '10:30 AM', cells: 'keep' },
    ], { mkId: mkId() })

    expect(out.timeSlots).toEqual([
      { id: 'slot_c1', startTime: '9:00 AM', endTime: '10:30 AM' },
    ])
    // Subjects survive the retime untouched.
    expect(out.grid.slot_c1).toEqual({
      Monday:  { type: 'class', mappingId: 'map_maths' },
      Tuesday: { type: 'class', mappingId: 'map_phy' },
    })
  })

  it('drops any slot the plan does not mention, and its grid row with it', () => {
    const out = restructureTimetable(liveTimetable(), [
      { match: '6:30 AM-7:00 AM', start: '6:30 AM', end: '7:00 AM', cells: allDays({ break: 'Wake Up' }) },
    ], { mkId: mkId() })

    expect(out.timeSlots.map(s => s.id)).toEqual(['slot_pt'])
    expect(out.grid.slot_ss_am).toBeUndefined()
    expect(out.grid.slot_c1).toBeUndefined()
  })

  it('mints a fresh id for an unmatched (new) row', () => {
    const out = restructureTimetable(liveTimetable(), [
      { match: null, start: '7:30 AM', end: '8:00 AM', cells: allDays({ break: 'Freshen Up' }) },
    ], { mkId: mkId() })

    expect(out.timeSlots).toEqual([
      { id: 'slot_new1', startTime: '7:30 AM', endTime: '8:00 AM' },
    ])
    expect(out.grid.slot_new1.Monday).toEqual({ type: 'break', label: 'Freshen Up' })
  })

  it('replaces a teaching row with a break, clearing every class cell', () => {
    const out = restructureTimetable(liveTimetable(), [
      { match: '4:00 PM-5:00 PM', start: '4:00 PM', end: '4:30 PM', cells: allDays({ break: 'Rest' }) },
    ], { mkId: mkId() })

    // The Monday Chemistry class and the Saturday Hi-Tea break are both gone.
    expect(out.grid.slot_pm).toEqual(
      Object.fromEntries(DAYS.map(d => [d, { type: 'break', label: 'Rest' }])),
    )
  })

  it('writes a per-day row without leaking one day into another', () => {
    const out = restructureTimetable(liveTimetable(), [
      {
        match: null, start: '4:30 PM', end: '5:30 PM',
        cells: {
          Monday: { break: 'Clubs' },     Tuesday:  { break: 'Games' },
          Wednesday: { break: 'Parade' }, Thursday: { break: 'Clubs' },
          Friday: { break: 'Games' },     Saturday: { break: 'Personality Classes' },
        },
      },
    ], { mkId: mkId() })

    expect(out.grid.slot_new1).toEqual({
      Monday:    { type: 'break', label: 'Clubs' },
      Tuesday:   { type: 'break', label: 'Games' },
      Wednesday: { type: 'break', label: 'Parade' },
      Thursday:  { type: 'break', label: 'Clubs' },
      Friday:    { type: 'break', label: 'Games' },
      Saturday:  { type: 'break', label: 'Personality Classes' },
    })
  })

  it('supports a mixed row — class on weekdays, break on Saturday', () => {
    const out = restructureTimetable(liveTimetable(), [
      {
        match: null, start: '6:00 PM', end: '8:00 PM',
        cells: {
          ...Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
            .map(d => [d, { class: 'map_ss' }])),
          Saturday: { break: 'Personality Classes' },
        },
      },
    ], { mkId: mkId() })

    expect(out.grid.slot_new1.Monday).toEqual({ type: 'class', mappingId: 'map_ss' })
    expect(out.grid.slot_new1.Saturday).toEqual({ type: 'break', label: 'Personality Classes' })
  })

  it('emits slots in plan order, so the grid reads top-to-bottom by clock', () => {
    const out = restructureTimetable(liveTimetable(), [
      { match: '6:30 AM-7:00 AM', start: '6:30 AM', end: '7:00 AM', cells: allDays({ break: 'Wake Up' }) },
      { match: null,              start: '7:30 AM', end: '8:00 AM', cells: allDays({ break: 'Freshen Up' }) },
      { match: '7:00 AM-8:00 AM', start: '7:00 AM', end: '7:30 AM', cells: allDays({ break: 'Physical Training' }) },
    ], { mkId: mkId() })

    expect(out.timeSlots.map(s => s.id)).toEqual(['slot_pt', 'slot_new1', 'slot_fresh'])
  })

  it('throws when a match names a slot the timetable does not have', () => {
    expect(() => restructureTimetable(liveTimetable(), [
      { match: '3:00 AM-4:00 AM', start: '3:00 AM', end: '4:00 AM', cells: allDays({ break: 'X' }) },
    ], { mkId: mkId() })).toThrow(/3:00 AM-4:00 AM/)
  })

  // Two plan rows claiming one slot would silently drop a row's history.
  it('throws when two plan rows match the same slot', () => {
    expect(() => restructureTimetable(liveTimetable(), [
      { match: '6:30 AM-7:00 AM', start: '6:30 AM', end: '7:00 AM', cells: allDays({ break: 'A' }) },
      { match: '6:30 AM-7:00 AM', start: '7:00 AM', end: '7:30 AM', cells: allDays({ break: 'B' }) },
    ], { mkId: mkId() })).toThrow(/twice/i)
  })

  it('leaves the source timetable untouched', () => {
    const live = liveTimetable()
    const snapshot = JSON.parse(JSON.stringify(live))
    restructureTimetable(live, [
      { match: '9:30 AM-10:50 AM', start: '9:00 AM', end: '10:30 AM', cells: allDays({ break: 'X' }) },
    ], { mkId: mkId() })
    expect(live).toEqual(snapshot)
  })

  it('preserves branch, batchName and id', () => {
    const out = restructureTimetable(liveTimetable(), [], { mkId: mkId() })
    expect(out).toMatchObject({ id: 'tt_1', branch: 'APJ', batchName: 'TEST_BATCH' })
  })
})
