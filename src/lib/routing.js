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
