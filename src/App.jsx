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
  const loadRemoteData        = useStore(s => s.loadRemoteData)
  const loadExamsFromSupabase = useStore(s => s.loadExamsFromSupabase)
  const activePage            = useStore(s => s.activePage)
  const [loaded, setLoaded]   = useState(false)

  useEffect(() => {
    async function loadAll() {
      const data = await loadFromSupabase()
      if (data) loadRemoteData(data)
      await loadExamsFromSupabase()
      setLoaded(true)
    }
    loadAll()
  }, [])

  const pages = {
    dashboard:  <DashboardPage />,
    exams:      <ExamsPage />,
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

  useEffect(() => {
    loadStudentData(data)
  }, [data])

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
              LWS PUNE · {data.profile?.batches?.[0] || 'Student View'}
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
          <StudentView name={data.name} attendance={data.attendance || []} lectureAbsencesProp={data.lectureAbsences || []} examAbsencesProp={data.examAbsences || []} homeworkPendingProp={data.homeworkPending || []} />
        </div>
      </div>
    </ModeContext.Provider>
  )
}
