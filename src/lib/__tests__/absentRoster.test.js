import { describe, it, expect } from 'vitest'
import { buildAbsentRoster, buildSlotTimeIndex } from '../absentRoster'

const PROFILES = {
  'arjun sharma': { lwsId: 'LWS-001', name: 'Arjun Sharma', batches: ['LWS_NDA_2Y_(25-27)_A'] },
  'bhavna rao':   { lwsId: 'LWS-002', name: 'Bhavna Rao',   batches: ['LWS_NDA_2Y_(25-27)_A', 'LWS_NDA_6M_(Sep26)'] },
  'chirag patil': { lwsId: 'LWS-003', name: 'Chirag Patil', batches: ['APJ_NDA_11th_(26-27)_A'] },
}

const SLOT_TIMES = {
  s1: { startTime: '9:00 AM', endTime: '10:00 AM' },
  s2: { startTime: '11:00 AM', endTime: '12:00 PM' },
}

describe('buildSlotTimeIndex', () => {
  it('indexes every timetable slot by id', () => {
    const index = buildSlotTimeIndex([
      { batchName: 'A', timeSlots: [{ id: 's1', startTime: '9:00 AM', endTime: '10:00 AM' }] },
      { batchName: 'B', timeSlots: [{ id: 's9', startTime: '2:00 PM', endTime: '3:00 PM' }] },
    ])
    expect(index.s1).toEqual({ startTime: '9:00 AM', endTime: '10:00 AM' })
    expect(index.s9).toEqual({ startTime: '2:00 PM', endTime: '3:00 PM' })
  })

  it('keeps the first timetable to claim a shared slot id and never throws on junk', () => {
    // Slot ids are per-timetable, so two batches can legitimately share one.
    // The time is display-only here, so first-wins is enough — but it must not
    // blow up on a timetable with no timeSlots.
    const index = buildSlotTimeIndex([
      { batchName: 'A', timeSlots: [{ id: 's1', startTime: '9:00 AM', endTime: '10:00 AM' }] },
      { batchName: 'B', timeSlots: [{ id: 's1', startTime: '4:00 PM', endTime: '5:00 PM' }] },
      { batchName: 'C' },
      null,
    ])
    expect(index.s1.startTime).toBe('9:00 AM')
  })

  it('returns an empty index for no timetables', () => {
    expect(buildSlotTimeIndex(null)).toEqual({})
  })
})

describe('buildAbsentRoster', () => {
  it('groups rows by student and resolves name + batches from the profile', () => {
    const out = buildAbsentRoster({
      rows: [
        { lws_id: 'LWS-001', slot_id: 's1', subject: 'Maths' },
        { lws_id: 'LWS-001', slot_id: 's2', subject: 'Physics' },
        { lws_id: 'LWS-003', slot_id: 's1', subject: 'Maths' },
      ],
      studentProfiles: PROFILES,
      slotTimes: SLOT_TIMES,
    })
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ lwsId: 'LWS-001', name: 'Arjun Sharma', batches: ['LWS_NDA_2Y_(25-27)_A'] })
    expect(out[0].periods.map(p => p.subject)).toEqual(['Maths', 'Physics'])
    expect(out[1]).toMatchObject({ lwsId: 'LWS-003', name: 'Chirag Patil' })
  })

  it('sorts students by name and each student\'s periods by clock time', () => {
    const out = buildAbsentRoster({
      rows: [
        { lws_id: 'LWS-003', slot_id: 's1', subject: 'Maths' },
        { lws_id: 'LWS-001', slot_id: 's2', subject: 'Physics' },
        { lws_id: 'LWS-001', slot_id: 's1', subject: 'Maths' },
      ],
      studentProfiles: PROFILES,
      slotTimes: SLOT_TIMES,
    })
    expect(out.map(s => s.name)).toEqual(['Arjun Sharma', 'Chirag Patil'])
    expect(out[0].periods.map(p => p.startTime)).toEqual(['9:00 AM', '11:00 AM'])
  })

  it('prefers the row\'s own time over the slot index (impromptu lectures)', () => {
    // Timetabled rows leave start_time NULL and re-derive from the timetable;
    // ad-hoc rows persist their entered time and have no slot to derive from.
    const out = buildAbsentRoster({
      rows: [{ lws_id: 'LWS-001', slot_id: 'adhoc_x1', subject: 'Doubt', start_time: '3:00 PM', end_time: '4:00 PM' }],
      studentProfiles: PROFILES,
      slotTimes: SLOT_TIMES,
    })
    expect(out[0].periods[0]).toMatchObject({ subject: 'Doubt', startTime: '3:00 PM', endTime: '4:00 PM' })
  })

  it('leaves times null when neither the row nor the slot index knows them', () => {
    const out = buildAbsentRoster({
      rows: [{ lws_id: 'LWS-001', slot_id: 'adhoc_x1', subject: 'Doubt' }],
      studentProfiles: PROFILES,
      slotTimes: SLOT_TIMES,
    })
    expect(out[0].periods[0]).toMatchObject({ subject: 'Doubt', startTime: null, endTime: null })
  })

  it('filters to one batch when batchName is given', () => {
    const out = buildAbsentRoster({
      rows: [
        { lws_id: 'LWS-001', slot_id: 's1', subject: 'Maths' },
        { lws_id: 'LWS-003', slot_id: 's1', subject: 'Maths' },
      ],
      studentProfiles: PROFILES,
      slotTimes: SLOT_TIMES,
      batchName: 'APJ_NDA_11th_(26-27)_A',
    })
    expect(out.map(s => s.lwsId)).toEqual(['LWS-003'])
  })

  it('matches a student who belongs to several batches', () => {
    const out = buildAbsentRoster({
      rows: [{ lws_id: 'LWS-002', slot_id: 's1', subject: 'Maths' }],
      studentProfiles: PROFILES,
      slotTimes: SLOT_TIMES,
      batchName: 'LWS_NDA_6M_(Sep26)',
    })
    expect(out.map(s => s.lwsId)).toEqual(['LWS-002'])
  })

  it('keeps a profile-less row in all-batches mode but drops it under a batch filter', () => {
    // Without a profile there is no batch to test, so a batch filter cannot
    // honestly claim the row. All-batches mode keeps it (falling back to the
    // id as the label) so the count never silently loses a student.
    const rows = [{ lws_id: 'LWS-404', slot_id: 's1', subject: 'Maths' }]
    const all = buildAbsentRoster({ rows, studentProfiles: PROFILES, slotTimes: SLOT_TIMES })
    expect(all.map(s => s.name)).toEqual(['LWS-404'])
    expect(all[0].batches).toEqual([])

    const filtered = buildAbsentRoster({
      rows, studentProfiles: PROFILES, slotTimes: SLOT_TIMES, batchName: 'LWS_NDA_2Y_(25-27)_A',
    })
    expect(filtered).toEqual([])
  })

  it('flags who has already been notified', () => {
    const out = buildAbsentRoster({
      rows: [
        { lws_id: 'LWS-001', slot_id: 's1', subject: 'Maths' },
        { lws_id: 'LWS-003', slot_id: 's1', subject: 'Maths' },
      ],
      studentProfiles: PROFILES,
      slotTimes: SLOT_TIMES,
      notifiedLwsIds: new Set(['LWS-001']),
    })
    expect(out.find(s => s.lwsId === 'LWS-001').notified).toBe(true)
    expect(out.find(s => s.lwsId === 'LWS-003').notified).toBe(false)
  })

  it('skips rows with no slot_id and returns [] for no rows', () => {
    // Legacy/orphan rows without slot_id are skipped everywhere else too.
    expect(buildAbsentRoster({ rows: [{ lws_id: 'LWS-001', subject: 'Maths' }], studentProfiles: PROFILES })).toEqual([])
    expect(buildAbsentRoster({ rows: null, studentProfiles: PROFILES })).toEqual([])
  })
})
