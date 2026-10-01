// Test helper (not a test file): serve the `faculty_state` row that
// api/_flowGate.js reads, from inside an endpoint test's mocked Supabase client.
//
// Usage: keep a module-level `flowState` object, reset it in beforeEach, and
// route `from('faculty_state')` through `facultyStateTable(flowState)` in the
// file's client mocks. A test then switches a flow off with
// `flowState.flows = { late: { enabled: false } }`, or breaks the read with
// `flowState.error = { message: 'boom' }`.
//
// `extra` merges further blob fields (the mentor test needs timetableTeachers).

export function newFlowState() {
  return { flows: undefined, error: null, extra: {} }
}

export function facultyStateTable(state) {
  const result = state.error
    ? { data: null, error: state.error }
    : { data: { data: { ...state.extra, whatsappFlows: state.flows } }, error: null }
  const b = {
    select: () => b,
    eq: () => b,
    single: () => Promise.resolve(result),
    then: (ok, ko) => Promise.resolve(result).then(ok, ko),
  }
  return b
}
