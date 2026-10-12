import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// There is no `.input` class — the app's text-field class is `.form-input`
// (src/index.css). A field marked `input` renders with no border, background or
// focus ring, which looks like plain text and fails our visible-focus rule.
// Found 2026-10-12 in 17 already-shipped files (SUGGESTIONS.md backfill ledger);
// this ratchet stops new code joining them. Remove a file from KNOWN as it is fixed.
const KNOWN = new Set([
  'pages/Quizzes/index.jsx',
  'pages/Quizzes/QuizEditor.jsx',
  'pages/Quizzes/QuizLinkPage.jsx',
  'pages/Settings/BatchesTab.jsx',
  'pages/Settings/BranchesTab.jsx',
  'pages/Settings/MentorshipTab.jsx',
  'pages/Settings/MonitoringTab.jsx',
  'pages/Settings/TeachersTab.jsx',
  'pages/Syllabus/AssignProgramsModal.jsx',
  'pages/Syllabus/ManageProgramModal.jsx',
  'pages/Syllabus/ManageSubjectModal.jsx',
  'pages/Timetable/AddExamScheduleModal.jsx',
  'pages/Timetable/AddTimetableModal.jsx',
  'pages/Timetable/EditCellModal.jsx',
  'pages/Timetable/ManageMappingsModal.jsx',
  'pages/Timetable/SyncCalendarModal.jsx',
  'pages/Timetable/TimetablePage.jsx',
])

const SRC = join(process.cwd(), 'src')

function jsxFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') return []
    if (statSync(p).isDirectory()) return jsxFiles(p)
    return p.endsWith('.jsx') ? [p] : []
  })
}

// `className="input"` or `className="input …"` — the bare class, not `form-input`.
const BARE_INPUT = /className=["'`]input(?:["'`\s])/

describe('CSS class ratchet', () => {
  const users = jsxFiles(SRC)
    .filter(f => BARE_INPUT.test(readFileSync(f, 'utf8')))
    .map(f => relative(SRC, f).split('\\').join('/'))

  it('no new file uses the undefined `input` class (use `form-input`)', () => {
    expect(users.filter(f => !KNOWN.has(f))).toEqual([])
  })

  it('the allow-list only names files that still need fixing', () => {
    expect([...KNOWN].filter(f => !users.includes(f))).toEqual([])
  })
})
