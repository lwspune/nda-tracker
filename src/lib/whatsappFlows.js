// The registry of every WhatsApp (Wabridge / Meta template) send flow, and the
// one predicate for "is this flow switched on?".
//
// Shared by the Settings → WhatsApp tab, the trigger buttons, and the server
// gate in api/_flowGate.js. Pure data + pure functions, no store import, because
// api/*.js imports it (with the .js extension — Node ESM needs it).
//
// The switch state lives in `faculty_state.data.whatsappFlows` as
// `{ [key]: { enabled: boolean } }`. An ABSENT key means ON. That default is
// load-bearing: the live blob predates the key, a stale tab may save without
// it, and the mentorship nudge runs from a cron with nobody watching. A default
// of off would silently stop it on the deploy that introduced the switch.
//
// The template ID VALUES are secrets and never appear here. `envVar` is the
// NAME only, shown in Settings so faculty know what to set in Vercel.
//
// Spec of record: WHATSAPP_FLOWS.md.

export const WHATSAPP_FLOWS = [
  {
    key: 'examResults',
    label: 'Exam results',
    description: "Each student's score for an exam, with a one-tap link to their result.",
    recipients: 'Student and parents, plus a monitoring copy',
    trigger: 'Exams page, WhatsApp Results button',
    endpoint: 'api/send-whatsapp.js',
    envVar: 'WABRIDGE_TEMPLATE_ID',
    variables: ['name', 'exam', 'date', 'percent', 'scored', 'out of', 'tracker link'],
    cron: null,
    settingsTab: 'monitoring',
  },
  {
    key: 'late',
    label: 'Late to first lecture',
    description: 'Tells the family the student arrived late to the first lecture.',
    recipients: 'Student and parents',
    trigger: 'Attendance page, Late widget',
    endpoint: 'api/send-late-notifications.js',
    envVar: 'WABRIDGE_LATE_TEMPLATE_ID',
    variables: ['name', 'date'],
    cron: null,
    settingsTab: null,
  },
  {
    key: 'lectureMiss',
    label: 'Lecture missed',
    description: 'Lists every period the student missed that day in one message.',
    recipients: 'Student and parents',
    trigger: 'Attendance page, Lecture log',
    endpoint: 'api/send-attendance-alerts.js',
    envVar: 'WABRIDGE_LECTURE_MISS_TEMPLATE_ID',
    variables: ['name', 'date', 'subjects'],
    cron: null,
    settingsTab: null,
  },
  {
    key: 'examAbsence',
    label: 'Exam absence',
    description: 'Tells the family the student did not sit an exam.',
    recipients: 'Student and parents',
    trigger: 'Exams page, Send Absent Alert button',
    endpoint: 'api/send-exam-absence.js',
    envVar: 'WABRIDGE_EXAM_ABSENCE_TEMPLATE_ID',
    variables: ['name', 'exam'],
    cron: null,
    settingsTab: null,
  },
  {
    key: 'homework',
    label: 'Homework / notes pending',
    description: 'One message per pending homework or notes item.',
    recipients: 'Student and parents',
    trigger: 'Attendance page, Homework log',
    endpoint: 'api/send-homework-pending.js',
    envVar: 'WABRIDGE_HOMEWORK_TEMPLATE_ID',
    variables: ['name', 'subject', 'chapter', 'type'],
    cron: null,
    settingsTab: null,
  },
  {
    key: 'mentorNudge',
    label: 'Mentorship nudge',
    description: "Each weekday morning, tells every mentor which mentees to check in with.",
    recipients: 'Mentor teachers',
    trigger: 'Daily cron at 07:30 IST, Monday to Friday',
    endpoint: 'api/send-mentor-nudges.js',
    envVar: 'WABRIDGE_MENTOR_NUDGE_TEMPLATE_ID',
    variables: ['date', 'students'],
    cron: 'live',
    settingsTab: 'mentorship',
  },
  {
    key: 'hostelAlert',
    label: 'Hostel warden alert',
    description: 'Lists APJ boarders who fell off the daily chain without an explanation.',
    recipients: 'Warden numbers set in the Hostel & Mess tab',
    trigger: 'Attendance page, Hostel & Mess tab, Alert warden button',
    endpoint: 'api/send-attendance-alerts.js',
    envVar: 'WABRIDGE_HOSTEL_ALERT_TEMPLATE_ID',
    variables: ['date', 'boarders'],
    cron: 'ready',
    settingsTab: null,
  },
]

export const FLOW_KEYS = WHATSAPP_FLOWS.map(f => f.key)

const BY_KEY = new Map(WHATSAPP_FLOWS.map(f => [f.key, f]))

export function getFlow(key) {
  return BY_KEY.get(key) ?? null
}

export function isKnownFlow(key) {
  return BY_KEY.has(key)
}

// Off ONLY for a literal `enabled: false`. Anything else, including a missing
// map, a missing entry, or a malformed value, reads as on. See the header.
export function isFlowEnabled(whatsappFlows, key) {
  return whatsappFlows?.[key]?.enabled !== false
}

// The text every disabled surface shows, so the button title, the server
// refusal and the Settings card all say the same thing.
export function flowOffMessage(key) {
  const label = getFlow(key)?.label ?? 'This WhatsApp message'
  return `${label} is switched off in Settings → WhatsApp`
}
