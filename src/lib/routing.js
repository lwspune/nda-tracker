// Path-based deep links.
//
// There is no router in this app — pages are `activePage` in the store, and
// App.jsx reads URL params (?quiz=, ?exam=, ?mobile=) for entry points. These
// helpers add the one path-shaped entry point: the link handed to teachers.
//
// vercel.json already rewrites every non-api path to index.html, so the URL
// reaches the app on its own; this is what gives it meaning. BASE_URL is '/'
// on Vercel and '/nda-tracker/' on the legacy GitHub Pages build.

export const SCHOOL_ATTENDANCE_PATH = '/school-attendance'

export function isSchoolAttendancePath(pathname, baseUrl = '/') {
  const path = String(pathname || '/').replace(baseUrl, '/')
  return path === SCHOOL_ATTENDANCE_PATH || path === `${SCHOOL_ATTENDANCE_PATH}/`
}

// The hostel & mess capture surface. Deliberately a sibling of
// SCHOOL_ATTENDANCE_PATH rather than a sub-path: "school" (lectures, all
// branches) and "hostel & mess" (APJ boarders) are different jobs done by
// different people, and neither should be reachable by shortening the other.
export const HOSTEL_ATTENDANCE_PATH = '/hostel-mess-attendance'

export function isHostelAttendancePath(pathname, baseUrl = '/') {
  const path = String(pathname || '/').replace(baseUrl, '/')
  return path === HOSTEL_ATTENDANCE_PATH || path === `${HOSTEL_ATTENDANCE_PATH}/`
}

// Scanning OMR answer sheets. A sibling of the capture paths above for the same
// reason they are siblings of each other: it is a different job, done standing
// over a stack of paper with a phone, by whoever is doing the marking that day.
// The Exams page manages exams at a desk and already carries eight controls per
// card; nobody is taking 300 photographs inside it.
export const SCAN_PATH = '/scan'

export function isScanPath(pathname, baseUrl = '/') {
  const path = String(pathname || '/').replace(baseUrl, '/')
  return path === SCAN_PATH || path === `${SCAN_PATH}/`
}

/**
 * The exam a /scan link names, or null.
 *
 * The printed sheet is deliberately identity-free — one run of 150Q sheets is
 * photocopied for any 150Q paper — so the exam can never be recovered from the
 * paper and has to be chosen at scan time. Choosing it from a list of every MCQ
 * exam the school has ever run is the tedium; naming it in the link is the fix.
 */
export function scanExamIdFromSearch(search) {
  const value = new URLSearchParams(String(search || '')).get('exam')
  return value ? value : null
}

/** The absolute /scan link for one exam — for the phone, not this screen. */
export function buildScanUrl(examId, origin = '', baseUrl = '/') {
  const url = buildCaptureUrl(SCAN_PATH, origin, baseUrl)
  return examId ? `${url}?exam=${encodeURIComponent(examId)}` : url
}

// The absolute link faculty hand to a teacher / the warden.
//
// The base prefix is the whole reason this isn't a template string at the call
// site: on the GitHub Pages build (`/nda-tracker/`) a link assembled without it
// 404s, and it does so silently — the person you sent it to just sees nothing.
// Origin is derived from the caller, so copying from prod yields the prod link.
export function buildCaptureUrl(path, origin = '', baseUrl = '/') {
  const base = String(baseUrl ?? '').replace(/\/+$/, '')  // '/nda-tracker/' → '/nda-tracker', '/' → ''
  return `${String(origin ?? '').replace(/\/+$/, '')}${base}${path}`
}
