// Detect if running on GitHub Pages (read-only) vs localhost (full access)
export const IS_READ_ONLY = window.location.hostname !== 'localhost' &&
  !window.location.hostname.startsWith('127.')

// URL to fetch db.json from the repo when in read-only mode
// Update REPO_NAME to match your GitHub repo
const REPO_NAME = 'nda-tracker'
const GH_USER = 'lwspune' // Update to your GitHub username
export const REMOTE_DATA_URL = IS_READ_ONLY
  ? `/${REPO_NAME}/data/db.json`
  : '/data/db.json'

// App info
export const APP_NAME = 'NDA Maths Tracker'
export const APP_SUB = 'LWS PUNE'
