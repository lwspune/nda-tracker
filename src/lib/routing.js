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
