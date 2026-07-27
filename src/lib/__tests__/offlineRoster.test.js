import { describe, it, expect } from 'vitest'
import { buildOfflineRoster, parseMarksPaste, buildOfflineStudentRows } from '../offlineRoster'

// studentProfiles is keyed by canonical name AND by every name variant, both
// pointing at the SAME entry object (see studentSlice.importStudentsDB).
function profiles(...entries) {
  const map = {}
  for (const e of entries) {
    map[e.name] = e
    for (const v of (e.nameVariants || [])) map[v] = e
  }
  return map
}

const alice = { lwsId: 'L1', name: 'Alice', batches: ['B1'], accountStatus: 'Active' }
const bob   = { lwsId: 'L2', name: 'Bob',   batches: ['B1'], accountStatus: 'Active' }
const carol = { lwsId: 'L3', name: 'Carol', batches: ['B2'], accountStatus: 'Active' }

describe('buildOfflineRoster', () => {
  it('returns current members of the selected batch, sorted by name', () => {
    const roster = buildOfflineRoster(profiles(bob, alice, carol), ['B1'])
    expect(roster.map(r => r.name)).toEqual(['Alice', 'Bob'])
    expect(roster[0]).toEqual({ lwsId: 'L1', name: 'Alice' })
  })

  it('unions members across multiple selected batches', () => {
    const roster = buildOfflineRoster(profiles(alice, bob, carol), ['B1', 'B2'])
    expect(roster.map(r => r.name)).toEqual(['Alice', 'Bob', 'Carol'])
  })

  it('lists a student in two selected batches exactly once', () => {
    const both = { lwsId: 'L9', name: 'Dev', batches: ['B1', 'B2'], accountStatus: 'Active' }
    const roster = buildOfflineRoster(profiles(both), ['B1', 'B2'])
    expect(roster.map(r => r.name)).toEqual(['Dev'])
  })

  it('emits the canonical name once, never a name variant as its own row', () => {
    const withVariant = { lwsId: 'L4', name: 'Rajesh Kumar', batches: ['B1'], nameVariants: ['R Kumar', 'Rajesh K'] }
    const roster = buildOfflineRoster(profiles(withVariant), ['B1'])
    expect(roster.map(r => r.name)).toEqual(['Rajesh Kumar'])
  })

  it('excludes blocked / quit / inactive students (they are not attending)', () => {
    const blocked = { lwsId: 'L5', name: 'Aarav', batches: ['B1'], accountStatus: 'Block' }
    const quit    = { lwsId: 'L6', name: 'Aditi', batches: ['B1'], accountStatus: 'Quit' }
    const roster  = buildOfflineRoster(profiles(alice, blocked, quit), ['B1'])
    expect(roster.map(r => r.name)).toEqual(['Alice'])
  })

  it('keeps a student with a blank accountStatus (legacy rows fail open)', () => {
    const legacy = { lwsId: 'L7', name: 'Ankit', batches: ['B1'], accountStatus: '' }
    const roster = buildOfflineRoster(profiles(legacy), ['B1'])
    expect(roster.map(r => r.name)).toEqual(['Ankit'])
  })

  it('returns [] when no batches are selected', () => {
    expect(buildOfflineRoster(profiles(alice, bob), [])).toEqual([])
  })

  it('returns [] for an unknown batch and tolerates missing profiles', () => {
    expect(buildOfflineRoster(profiles(alice), ['NOPE'])).toEqual([])
    expect(buildOfflineRoster(null, ['B1'])).toEqual([])
    expect(buildOfflineRoster(undefined, undefined)).toEqual([])
  })
})

describe('parseMarksPaste', () => {
  it('parses a single pasted column top-down', () => {
    expect(parseMarksPaste('72\n55\n40')).toEqual([72, 55, 40])
  })

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseMarksPaste('72\r\n55\r\n')).toEqual([72, 55])
  })

  it('preserves interior blanks as null (student did not appear)', () => {
    expect(parseMarksPaste('72\n\n40')).toEqual([72, null, 40])
  })

  it('takes the last tab-separated cell so a Name+Marks paste works', () => {
    expect(parseMarksPaste('Alice\t72\nBob\t55')).toEqual([72, 55])
  })

  it('treats a row whose last cell is empty as null', () => {
    expect(parseMarksPaste('Alice\t72\nBob\t')).toEqual([72, null])
  })

  it('keeps an explicit zero (a real mark, not a blank)', () => {
    expect(parseMarksPaste('0\n72')).toEqual([0, 72])
  })

  it('parses decimals', () => {
    expect(parseMarksPaste('68.5')).toEqual([68.5])
  })

  it('maps a non-numeric cell to null rather than NaN', () => {
    expect(parseMarksPaste('72\nAB\n40')).toEqual([72, null, 40])
  })

  it('returns [] for empty or whitespace-only text', () => {
    expect(parseMarksPaste('')).toEqual([])
    expect(parseMarksPaste('   \n  ')).toEqual([])
    expect(parseMarksPaste(null)).toEqual([])
  })
})

describe('buildOfflineStudentRows', () => {
  const roster = [{ lwsId: 'L1', name: 'Alice' }, { lwsId: 'L2', name: 'Bob' }, { lwsId: 'L3', name: 'Carol' }]

  it('builds totals-only student rows in the same shape as the file parser', () => {
    const rows = buildOfflineStudentRows(roster, { Alice: '72', Bob: '55', Carol: '40' })
    expect(rows[0]).toEqual({
      name: 'Alice', rollNo: '', totalMarks: 72,
      correct: 0, incorrect: 0, notAttempted: 0, responses: {},
    })
    expect(rows).toHaveLength(3)
  })

  it('skips students left blank — a blank means they did not appear', () => {
    const rows = buildOfflineStudentRows(roster, { Alice: '72', Bob: '', Carol: '40' })
    expect(rows.map(r => r.name)).toEqual(['Alice', 'Carol'])
  })

  it('keeps an explicit 0 as a real mark', () => {
    const rows = buildOfflineStudentRows(roster, { Alice: '0' })
    expect(rows).toHaveLength(1)
    expect(rows[0].totalMarks).toBe(0)
  })

  it('accepts numeric as well as string marks', () => {
    const rows = buildOfflineStudentRows(roster, { Alice: 72, Bob: 55.5 })
    expect(rows.map(r => r.totalMarks)).toEqual([72, 55.5])
  })

  it('drops a non-numeric entry instead of writing NaN', () => {
    const rows = buildOfflineStudentRows(roster, { Alice: 'abc', Bob: '55' })
    expect(rows.map(r => r.name)).toEqual(['Bob'])
  })

  it('preserves roster order', () => {
    const rows = buildOfflineStudentRows(roster, { Carol: '40', Alice: '72' })
    expect(rows.map(r => r.name)).toEqual(['Alice', 'Carol'])
  })

  it('returns [] when nothing is entered', () => {
    expect(buildOfflineStudentRows(roster, {})).toEqual([])
    expect(buildOfflineStudentRows([], { Alice: '72' })).toEqual([])
  })
})
