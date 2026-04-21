// Detect read-only mode (GitHub Pages) vs full mode (localhost / LAN dev server)
const _h = window.location.hostname
export const IS_READ_ONLY = _h !== 'localhost' &&
  !_h.startsWith('127.') &&
  !_h.startsWith('192.168.') &&
  !_h.startsWith('10.') &&
  !_h.startsWith('172.')

const REPO_NAME = 'nda-tracker'

// Base URL for data files on GitHub Pages
const BASE = IS_READ_ONLY ? `/${REPO_NAME}` : ''

export const REMOTE_DATA_URL    = `${BASE}/data/db.json`
export const INDEX_URL          = `${BASE}/data/index.json`
export const STUDENT_FILE_URL   = (file) => `${BASE}/data/students/${file}`
// Session config
export const SESSION_KEY         = 'nda_student_session'
export const TEACHER_SESSION_KEY = 'nda_teacher_session'
export const SESSION_DAYS        = 7

// App info
export const APP_NAME = 'NDA Tracker'
export const APP_SUB  = 'LWS PUNE'
