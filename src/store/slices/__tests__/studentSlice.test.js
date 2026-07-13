import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStudentSlice } from '../studentSlice'

// No Supabase session in tests → all mutations use the /api/students-db (dev) path.
vi.mock('../../../lib/supabase', () => ({ supabase: null }))

function makeStore() {
  let state = { studentProfiles: {}, studentList: [] }
  let slice
  const get = () => ({
    ...state,
    _save: () => {},
    ...Object.fromEntries(Object.entries(slice ?? {}).filter(([, v]) => typeof v === 'function')),
  })
  const set = (fn) => { state = { ...state, ...(typeof fn === 'function' ? fn(state) : fn) } }
  slice = createStudentSlice(set, get)
  return { slice, getState: () => state }
}

function mockFetch(students) {
  vi.stubGlobal('fetch', vi.fn((_url, opts) => {
    if (!opts || opts.method !== 'POST') {
      return Promise.resolve({ json: () => Promise.resolve({ students }) })
    }
    return Promise.resolve({ ok: true })
  }))
}

function makeStudent(overrides = {}) {
  return {
    lws_id:            'LWS-183',
    canonical_name:    'Nirnit Hemraj Patil',
    name_variants:     [],
    branch:            '',
    batches:           [],
    mobile:            '',
    parent_mobiles:    [],
    account_status:    '',
    coming_status:     '',
    registration_date: '',
    quit_date:         null,
    ...overrides,
  }
}

// ── importStudentsDB ──────────────────────────────────────────

describe('importStudentsDB', () => {
  it('stores the raw snake_case array as studentList', () => {
    const students = [
      makeStudent({ lws_id: 'LWS-003', canonical_name: 'Vaidehee Rayrikar', branch: '' }),
      makeStudent({ lws_id: 'LWS-404', canonical_name: 'Vaidehee Rayrikar', branch: 'LWS' }),
    ]
    const { slice, getState } = makeStore()
    slice.importStudentsDB(students)
    expect(getState().studentList).toEqual(students)
  })

  it('studentList includes all rows even when two share the same canonical_name', () => {
    const students = [
      makeStudent({ lws_id: 'LWS-003', canonical_name: 'Vaidehee Rayrikar' }),
      makeStudent({ lws_id: 'LWS-404', canonical_name: 'Vaidehee Rayrikar' }),
    ]
    const { slice, getState } = makeStore()
    slice.importStudentsDB(students)
    expect(getState().studentList).toHaveLength(2)
  })

  it('carries residential into the profile (defaults to boarder when unset)', () => {
    const { slice, getState } = makeStore()
    slice.importStudentsDB([
      makeStudent({ lws_id: 'LWS-001', canonical_name: 'Boarder',     residential: true }),
      makeStudent({ lws_id: 'LWS-002', canonical_name: 'Day Scholar', residential: false }),
      makeStudent({ lws_id: 'LWS-003', canonical_name: 'Unset' }), // no residential → default boarder
    ])
    const p = getState().studentProfiles
    expect(p['Boarder'].residential).toBe(true)
    expect(p['Day Scholar'].residential).toBe(false)
    expect(p['Unset'].residential).toBe(true)
  })
})

// ── addNameVariant ────────────────────────────────────────────

describe('addNameVariant', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('adds a new variant to the matching student', async () => {
    mockFetch([makeStudent()])
    const { slice, getState } = makeStore()
    await slice.addNameVariant('LWS-183', 'Nirnit Patil')
    expect(getState().studentProfiles['Nirnit Hemraj Patil'].nameVariants).toContain('Nirnit Patil')
  })

  it('immediately indexes the variant in studentProfiles so lookups work', async () => {
    mockFetch([makeStudent()])
    const { slice, getState } = makeStore()
    await slice.addNameVariant('LWS-183', 'Nirnit Patil')
    const entry = getState().studentProfiles['Nirnit Patil']
    expect(entry).toBeDefined()
    expect(entry.lwsId).toBe('LWS-183')
  })

  it('does not duplicate a variant already present', async () => {
    mockFetch([makeStudent({ name_variants: ['Nirnit Patil'] })])
    const { slice, getState } = makeStore()
    await slice.addNameVariant('LWS-183', 'Nirnit Patil')
    const variants = getState().studentProfiles['Nirnit Hemraj Patil'].nameVariants
    expect(variants.filter(v => v === 'Nirnit Patil')).toHaveLength(1)
  })

  it('does not modify other students', async () => {
    mockFetch([
      makeStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma' }),
      makeStudent(),
    ])
    const { slice, getState } = makeStore()
    await slice.addNameVariant('LWS-183', 'Nirnit Patil')
    expect(getState().studentProfiles['Alice Sharma'].nameVariants).toEqual([])
  })

  it('does nothing and does not call fetch when lwsId is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { slice } = makeStore()
    await slice.addNameVariant('', 'Nirnit Patil')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does nothing and does not call fetch when variantName is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { slice } = makeStore()
    await slice.addNameVariant('LWS-183', '')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// ── deleteStudent ────────────────────────────────────────────

describe('deleteStudent', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('removes the matching student from studentList (dev path)', async () => {
    mockFetch([
      makeStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma' }),
      makeStudent({ lws_id: 'LWS-002', canonical_name: 'Bob Kumar' }),
    ])
    const { slice, getState } = makeStore()
    await slice.deleteStudent('LWS-001')
    const ids = getState().studentList.map(s => s.lws_id)
    expect(ids).toEqual(['LWS-002'])
  })

  it('removes the matching student from studentProfiles', async () => {
    mockFetch([
      makeStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma' }),
      makeStudent({ lws_id: 'LWS-002', canonical_name: 'Bob Kumar' }),
    ])
    const { slice, getState } = makeStore()
    await slice.deleteStudent('LWS-001')
    expect(getState().studentProfiles['Alice Sharma']).toBeUndefined()
    expect(getState().studentProfiles['Bob Kumar']).toBeDefined()
  })

  it('clears activeStudent when it matches the deleted student', async () => {
    mockFetch([makeStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma' })])
    const { slice, getState } = makeStore()
    // Seed activeStudent to the about-to-be-deleted student
    getState().activeStudent = 'Alice Sharma'
    await slice.deleteStudent('LWS-001')
    expect(getState().activeStudent).toBeNull()
  })

  it('does NOT clear activeStudent when it points to a different student', async () => {
    mockFetch([
      makeStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma' }),
      makeStudent({ lws_id: 'LWS-002', canonical_name: 'Bob Kumar' }),
    ])
    const { slice, getState } = makeStore()
    getState().activeStudent = 'Bob Kumar'
    await slice.deleteStudent('LWS-001')
    expect(getState().activeStudent).toBe('Bob Kumar')
  })

  it('does nothing and does not call fetch when lwsId is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { slice } = makeStore()
    await slice.deleteStudent('')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is a no-op when the lws_id is not found', async () => {
    const initial = [makeStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma' })]
    mockFetch(initial)
    const { slice, getState } = makeStore()
    slice.importStudentsDB(initial) // seed the in-store list
    await slice.deleteStudent('LWS-MISSING')
    expect(getState().studentList).toHaveLength(1)
    expect(getState().studentProfiles['Alice Sharma']).toBeDefined()
  })
})

// ── setAccountStatus ─────────────────────────────────────────

describe('setAccountStatus', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('blocks the matching student without touching others (dev path)', async () => {
    mockFetch([
      makeStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma', account_status: 'Active' }),
      makeStudent({ lws_id: 'LWS-002', canonical_name: 'Bob Kumar',    account_status: 'Active' }),
    ])
    const { slice, getState } = makeStore()
    await slice.setAccountStatus('LWS-001', 'Block')
    expect(getState().studentProfiles['Alice Sharma'].accountStatus).toBe('Block')
    expect(getState().studentProfiles['Bob Kumar'].accountStatus).toBe('Active')
  })

  it('unblocks by writing the status back to Active', async () => {
    mockFetch([makeStudent({ lws_id: 'LWS-001', canonical_name: 'Alice Sharma', account_status: 'Block' })])
    const { slice, getState } = makeStore()
    await slice.setAccountStatus('LWS-001', 'Active')
    expect(getState().studentProfiles['Alice Sharma'].accountStatus).toBe('Active')
  })

  it('does nothing and does not call fetch when lwsId is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { slice } = makeStore()
    await slice.setAccountStatus('', 'Block')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
