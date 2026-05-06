import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStudentSlice } from '../studentSlice'

// No Supabase session in tests → all mutations use the /api/students-db (dev) path.
vi.mock('../../../lib/supabase', () => ({ supabase: null }))

function makeStore() {
  let state = { studentProfiles: {} }
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
