// Detect read-only mode (GitHub Pages) vs full mode (localhost / LAN dev server)
const _h = window.location.hostname
export const IS_READ_ONLY = _h !== 'localhost' &&
  !_h.startsWith('127.') &&
  !_h.startsWith('192.168.') &&
  !_h.startsWith('10.') &&
  !_h.startsWith('172.')

// Base URL for data files — '/' in dev and Vercel, '/nda-tracker/' on GitHub Pages
// Set by passing --base=/nda-tracker/ to vite build in the predeploy script.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export const REMOTE_DATA_URL    = `${BASE}/data/db.json`
// Session config
export const SESSION_KEY         = 'nda_student_session'
export const TEACHER_SESSION_KEY = 'nda_teacher_session'
export const SESSION_DAYS        = 7

// App info
export const APP_NAME = 'NDA Tracker'
export const APP_SUB  = 'LWS PUNE'
