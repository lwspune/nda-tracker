import { useEffect, useMemo, useState } from 'react'
import useStore from '../../store/useStore'
import { useMode } from '../../context/ModeContext'
import { PageHeader, Card, Badge, EmptyState, Alert } from '../../components/ui'
import { getSession } from '../../store/slices/session'
import { buildOfflineRoster } from '../../lib/offlineRoster'
import { assignmentState } from '../../lib/assignments/status'
import { visibleAssignments, fmtDeadline } from '../../lib/assignments/editor'
import HomeworkEditor from './HomeworkEditor'
import HomeworkSubmissions from './HomeworkSubmissions'

const STATE_BADGE = {
  draft:  { variant: 'gray',  label: 'Draft' },
  open:   { variant: 'green', label: 'Open' },
  closed: { variant: 'red',   label: 'Closed' },
}

// A held grade (handwriting check) is handed in, just not released.
const HANDED_IN = new Set(['submitted', 'held', 'graded'])

// Homework with uploaded answers (2026-10-12). Separate from Attendance →
// Homework, which records who DIDN'T do their homework for the parent WhatsApp;
// this is where homework is set, handed in and graded.
//
// A teacher sees and edits only what they set (the database enforces the
// writes); an admin sees everything. Online only: files live in Supabase
// Storage, which needs a signed-in session.
export default function HomeworkPage({ email: emailProp }) {
  const mode = useMode()
  const assignments     = useStore(s => s.homeworkAssignments)
  const loaded          = useStore(s => s.homeworkAssignmentsLoaded)
  const load            = useStore(s => s.loadHomeworkAssignments)
  const getStatuses     = useStore(s => s.getHomeworkSubmissionStatuses)
  const deleteHomework  = useStore(s => s.deleteHomeworkAssignment)
  const studentProfiles = useStore(s => s.studentProfiles)

  const [sessionEmail, setSessionEmail] = useState(null)
  const [statuses, setStatuses] = useState([])
  const [editing, setEditing] = useState(null)     // null · 'new' · assignment id
  const [viewing, setViewing] = useState(null)     // assignment id
  const [error, setError] = useState('')

  // The admin portal doesn't hand the page an email; ask the session for it.
  useEffect(() => {
    if (emailProp) return
    getSession().then(s => setSessionEmail(s?.user?.email ?? ''))
  }, [emailProp])
  const email = emailProp ?? sessionEmail

  useEffect(() => {
    load()
    getStatuses().then(r => setStatuses(r ?? []))
  }, [load, getStatuses, editing])

  const visible = useMemo(
    () => visibleAssignments(assignments, { mode, email })
      .slice()
      .sort((a, b) => String(b.dueAt).localeCompare(String(a.dueAt))),
    [assignments, mode, email],
  )

  if (editing) {
    const assignment = editing === 'new' ? null : assignments.find(a => a.id === editing)
    return <HomeworkEditor assignment={assignment} email={email} onDone={() => setEditing(null)} />
  }
  if (viewing) {
    const assignment = assignments.find(a => a.id === viewing)
    if (assignment) return <HomeworkSubmissions assignment={assignment} email={email} onBack={() => setViewing(null)} />
  }

  async function handleDelete(a) {
    if (!window.confirm(`Delete "${a.title}" and its question paper? This cannot be undone.`)) return
    setError('')
    const r = await deleteHomework(a)
    if (!r.ok) setError(r.error)
  }

  return (
    <div>
      <PageHeader
        title="Homework"
        sub="Set homework with a question paper and a deadline. Students upload photos or a PDF of their answers, and see their marks once graded."
        actions={<button className="btn btn-primary text-[13px]" onClick={() => setEditing('new')}>+ New homework</button>}
      />
      {error && <Alert type="error">{error}</Alert>}

      {loaded && visible.length === 0 ? (
        <EmptyState icon="📤" title="No homework yet"
                    sub="Upload a question paper, pick the batches and set a deadline. Students hand in from their portal." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(a => {
            const state = assignmentState(a)
            const badge = STATE_BADGE[state]
            const members = buildOfflineRoster(studentProfiles, a.batchNames).length
            const handedIn = new Set(
              statuses.filter(s => s.assignmentId === a.id && HANDED_IN.has(s.status)).map(s => s.lwsId),
            ).size
            const waiting = statuses.filter(s => s.assignmentId === a.id && s.status === 'submitted').length
            const held = statuses.filter(s => s.assignmentId === a.id && s.status === 'held').length
            return (
              <Card key={a.id} className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[14px] font-bold text-ink leading-snug">{a.title}</div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
                <div className="text-[11px] text-ink-3 font-mono">{a.subject} · out of {a.maxMarks}</div>
                <div className="text-[11px] text-ink-3">{a.batchNames.join(', ') || '—'}</div>
                <div className="text-[11px] text-ink-3">Due {fmtDeadline(a.dueAt)}</div>
                {state !== 'draft' && (
                  <div className="text-[12px] text-ink-2 font-semibold">
                    {handedIn} of {members} submitted{waiting ? ` · ${waiting} waiting to be graded` : ''}
                    {held ? ` · ${held} held for a handwriting check` : ''}
                  </div>
                )}
                <div className="flex items-center gap-3 mt-auto pt-2 border-t border-border">
                  <button className="text-[12px] font-semibold text-accent hover:underline" onClick={() => setEditing(a.id)}>Edit</button>
                  {state !== 'draft' && (
                    <button className="text-[12px] font-semibold text-ink-2 hover:underline" onClick={() => setViewing(a.id)}>Submissions</button>
                  )}
                  <button className="text-[12px] text-red-500 hover:text-red-700 ml-auto" onClick={() => handleDelete(a)}>Delete</button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
