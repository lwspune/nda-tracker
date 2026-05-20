// Empty module — used as a no-op alias for Node-only modules (e.g. `stream`)
// that browser-side libraries (xlsx) optionally probe via `require()`.
// Returning `{}` lets the optional-feature short-circuits short-circuit cleanly
// rather than throwing on Vite's externalised-module stub.
export default {}
