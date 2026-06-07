import { useEffect, useState } from 'react'
import useStore from './store/useStore'
import { IS_READ_ONLY } from './config'
import { supabase } from './lib/supabase'
import { ModeContext } from './context/ModeContext'
import { loadFromSupabase } from './store/persist'
import Sidebar from './components/layout/Sidebar'
import ApiBar from './components/layout/ApiBar'
import UploadModal from './components/upload/UploadModal'
import ExamsPage from './pages/Exams'
import QuizzesPage from './pages/Quizzes'
import DashboardPage from './pages/Dashboard'
import StudentsPage from './pages/Students'
import ToppersPage from './pages/Toppers'
import InsightsPage from './pages/Insights'
import CostsPage from './pages/Costs'
import SyllabusPage from './pages/Syllabus/SyllabusPage'
import TimetablePage from './pages/Timetable/TimetablePage'
import SettingsPage from './pages/Settings/SettingsPage'
import MonthlyReportsPage from './pages/MonthlyReports'
import TeacherFeedbackPage from './pages/TeacherFeedback'
import LoginPage, { clearStudentSession } from './components/auth/LoginPage'
import StudentView from './pages/Students/StudentView'
import FocusedExamResult from './pages/Students/FocusedExamResult'
import StudentQuizzes from './pages/Quizzes/StudentQuizzes'
import QuizLinkPage from './pages/Quizzes/QuizLinkPage'
import AttendancePage from './pages/Attendance'
export default function App() {
  const activePage = useStore(s => s.activePage)
  const hydrated   = useStore(s => s.hydrated)
  const initStore        = useStore(s => s.initStore)

  // GitHub Pages / Vercel: track which mode authenticated
  const [studentData, setStudentData]         = useState(null)
  const [supabaseSession, setSupabaseSession] = useState(null)
  const [sessionChecked, setSessionChecked]   = useState(!IS_READ_ONLY) // dev = already known

  // Supabase auth listener — online staff (admin or teacher) mode
  useEffect(() => {
    if (!supabase) { setSessionChecked(true); return }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSupabaseSession(session)
      setSessionChecked(true)
      // Recompute the superadmin flag on EVERY auth change (login / logout /
      // initial restore), not just once in initStore — otherwise logging in
      // after the page loaded logged-out never reveals the superadmin surfaces.
      if (IS_READ_ONLY) {
        useStore.setState({ isSuperadmin: session?.user?.user_metadata?.role === 'superadmin' })
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load data: dev = from disk, prod admin = from Supabase, prod teacher/student = no-op
  useEffect(() => { initStore() }, [])

  // Shareable quiz link (?quiz=<id>): focused, self-contained student quiz page.
  // Independent of the store + auth — handles its own one-time mobile identity.
  const quizLinkId = new URLSearchParams(window.location.search).get('quiz')
  if (quizLinkId) {
    return (
      <ModeContext.Provider value="student">
        <QuizLinkPage quizId={quizLinkId} />
      </ModeContext.Provider>
    )
  }

  // Block render until data is loaded AND (for IS_READ_ONLY) auth state is known
  if (!hydrated || (IS_READ_ONLY && !sessionChecked)) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-[28px] mb-3">📊</div>
          <div className="text-[14px] font-semibold text-ink-2">Loading data…</div>
          <div className="text-[11px] text-ink-3 mt-1 font-mono">
            {!IS_READ_ONLY ? 'reading faculty-data.json' : 'connecting…'}
          </div>
        </div>
      </div>
    )
  }

  // ── Read-only (Vercel / GitHub Pages) mode ─────────────────
  if (IS_READ_ONLY) {
    // Teacher role — individual Supabase account with role='teacher'
    if (supabaseSession?.user?.user_metadata?.role === 'teacher') {
      return <TeacherPortal onLogout={() => supabase.auth.signOut()} />
    }

    // Online admin — Supabase session without teacher role metadata
    if (supabaseSession) {
      return <OnlineAdminPortal onLogout={() => supabase.auth.signOut()} />
    }

    // Student portal
    if (studentData) {
      return (
        <StudentPortal
          data={studentData}
          onLogout={() => { clearStudentSession(); setStudentData(null) }}
        />
      )
    }

    // No session → unified login
    return <LoginPage onStudentLogin={setStudentData} />
  }

  // ── Dev admin mode (localhost) ──────────────────────────────
  const pages = {
    dashboard:  <DashboardPage />,
    exams:      <ExamsPage />,
    quizzes:    <QuizzesPage />,
    students:   <StudentsPage />,
    attendance: <AttendancePage />,
    toppers:    <ToppersPage />,
    syllabus:   <SyllabusPage />,
    timetable:  <TimetablePage />,
    insights:        <InsightsPage />,
    monthlyReports:  <MonthlyReportsPage />,
    costs:           <CostsPage />,
    settings:        <SettingsPage />,
    teacherFeedback: <TeacherFeedbackPage />,
  }

  return (
    <ModeContext.Provider value="admin">
      <div className="flex min-h-screen bg-bg">
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-screen md:ml-[228px] pt-[56px] md:pt-0 pb-[60px] md:pb-0">
          <div className="hidden md:block"><ApiBar /></div>
          <main className="flex-1 p-4 md:p-8 md:pt-7">
            {pages[activePage] ?? <DashboardPage />}
          </main>
        </div>
        <UploadModal />
      </div>
    </ModeContext.Provider>
  )
}

// ── Online Admin Portal ────────────────────────────────────────
// Vercel + Supabase auth session, no teacher role metadata. Same layout as dev admin mode.
function OnlineAdminPortal({ onLogout }) {
  const activePage = useStore(s => s.activePage)

  const pages = {
    dashboard:  <DashboardPage />,
    exams:      <ExamsPage />,
    quizzes:    <QuizzesPage />,
    students:   <StudentsPage />,
    attendance: <AttendancePage />,
    toppers:    <ToppersPage />,
    syllabus:   <SyllabusPage />,
    timetable:  <TimetablePage />,
    insights:        <InsightsPage />,
    monthlyReports:  <MonthlyReportsPage />,
    costs:           <CostsPage />,
    settings:        <SettingsPage />,
    teacherFeedback: <TeacherFeedbackPage />,
  }

  return (
    <ModeContext.Provider value="admin">
      <div className="flex min-h-screen bg-bg">
        <Sidebar onLogout={onLogout} />
        <div className="flex-1 flex flex-col min-h-screen md:ml-[228px] pt-[56px] md:pt-0 pb-[60px] md:pb-0">
          <div className="hidden md:block"><ApiBar /></div>
          <main className="flex-1 p-4 md:p-8 md:pt-7">
            {pages[activePage] ?? <DashboardPage />}
          </main>
        </div>
        <UploadModal />
      </div>
    </ModeContext.Provider>
  )
}

// ── Teacher Portal ─────────────────────────────────────────────
// Loads read-only data from Supabase faculty_state on mount.
// Syllabus/timetable/settings come from faculty_state JSONB;
// exams come from normalised tables via loadExamsFromSupabase.
function TeacherPortal({ onLogout }) {
  const loadRemoteData          = useStore(s => s.loadRemoteData)
  const loadExamsFromSupabase   = useStore(s => s.loadExamsFromSupabase)
  const loadQuizzesFromSupabase = useStore(s => s.loadQuizzesFromSupabase)
  const activePage              = useStore(s => s.activePage)
  const [loaded, setLoaded]     = useState(false)

  useEffect(() => {
    async function loadAll() {
      const data = await loadFromSupabase()
      if (data) loadRemoteData(data)
      await loadExamsFromSupabase()
      await loadQuizzesFromSupabase()
      setLoaded(true)
    }
    loadAll()
  }, [])

  const pages = {
    dashboard:  <DashboardPage />,
    exams:      <ExamsPage />,
    quizzes:    <QuizzesPage />,
    students:   <StudentsPage />,
    attendance: <AttendancePage />,
    toppers:    <ToppersPage />,
    syllabus:   <SyllabusPage />,
    timetable:  <TimetablePage />,
  }

  if (!loaded) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-[14px] font-semibold text-ink-2">Loading data…</div>
      </div>
    )
  }

  return (
    <ModeContext.Provider value="teacher">
      <div className="flex min-h-screen bg-bg">
        <Sidebar onLogout={onLogout} />
        <div className="flex-1 flex flex-col min-h-screen md:ml-[228px] pt-[56px] md:pt-0 pb-[60px] md:pb-0">
          <main className="flex-1 p-4 md:p-8 md:pt-7">
            {pages[activePage] ?? <DashboardPage />}
          </main>
        </div>
      </div>
    </ModeContext.Provider>
  )
}

// ── Student Portal ─────────────────────────────────────────────
// Wraps StudentView with student-specific data loaded from their JSON file
function StudentPortal({ data, onLogout }) {
  const loadStudentData = useStore(s => s.loadStudentData)

  // Deep-link from the WhatsApp result message: `?exam=<id>` focuses that exam's
  // result at the top so parents don't have to hunt for it on the dashboard.
  const [focusedExamId] = useState(() =>
    new URLSearchParams(window.location.search).get('exam') || null
  )
  // On a deep-link arrival we show ONLY the focused result + a reveal button, so
  // the parent isn't overwhelmed by the full dashboard. Revealed on click.
  const [showFull, setShowFull] = useState(false)
  const focusedExam = focusedExamId ? (data.exams || []).find(e => e.id === focusedExamId) : null
  const focusedMode = Boolean(focusedExam) && !showFull

  useEffect(() => {
    loadStudentData(data)
  }, [data])

  // Strip `?exam=` after first read so a restored/bookmarked session doesn't stay
  // pinned to one exam on later visits.
  useEffect(() => {
    if (!focusedExamId) return
    const url = new URL(window.location.href)
    url.searchParams.delete('exam')
    window.history.replaceState({}, '', url)
  }, [focusedExamId])

  return (
    <ModeContext.Provider value="student">
      <div className="min-h-screen bg-bg">
        {/* Simple top bar */}
        <div className="fixed top-0 left-0 right-0 z-50 bg-sidebar border-b border-white/[0.07]
                        flex items-center justify-between px-4 py-3">
          <div>
            <div className="text-[15px] font-extrabold text-indigo-300 tracking-tight">
              🎯 NDA Tracker
            </div>
            <div className="text-[9px] font-mono text-indigo-300/30 tracking-[1.5px] uppercase">
              LWS PUNE · {data.name}{data.profile?.batches?.[0] ? ` · ${data.profile.batches[0]}` : ''}
            </div>
          </div>
          <button
            onClick={onLogout}
            className="text-[11px] font-semibold text-indigo-300/50 hover:text-indigo-300
                       transition-colors px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-[44px] flex items-center"
          >
            Logout
          </button>
        </div>

        <div className="pt-[72px] pb-8 px-4 md:px-8 max-w-4xl mx-auto">
          {/* Parent view banner — names the child so a parent is sure whose data this is */}
          {data.viaParent && (
            <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-xl bg-indigo-50
                            border border-indigo-200 text-[13px] text-indigo-900">
              <span className="text-[15px] flex-shrink-0">👨‍👩‍👦</span>
              <span>Parent view — showing <strong>{data.name}</strong>'s results.</span>
            </div>
          )}
          <FocusedExamResult examId={focusedExamId} exams={data.exams || []} />
          {focusedMode ? (
            <button
              onClick={() => setShowFull(true)}
              className="w-full py-3 rounded-xl font-bold text-[14px] border border-border
                         bg-surface text-ink-2 hover:bg-accent-soft hover:text-accent
                         hover:border-accent/30 transition-all"
            >
              View full performance ↓
            </button>
          ) : (
            <>
              <StudentQuizzes mobile={data.profile?.mobile} />
              <StudentView name={data.name} attendance={data.attendance || []} lectureAbsencesProp={data.lectureAbsences || []} examAbsencesProp={data.examAbsences || []} homeworkPendingProp={data.homeworkPending || []} />
            </>
          )}
        </div>
      </div>
    </ModeContext.Provider>
  )
}
