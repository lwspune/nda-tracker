import { useEffect, useState } from 'react'
import useStore from './store/useStore'
import { IS_READ_ONLY } from './config'
import { ModeContext } from './context/ModeContext'
import Sidebar from './components/layout/Sidebar'
import ApiBar from './components/layout/ApiBar'
import UploadModal from './components/upload/UploadModal'
import ExamsPage from './pages/Exams'
import DashboardPage from './pages/Dashboard'
import StudentsPage from './pages/Students'
import ToppersPage from './pages/Toppers'
import InsightsPage from './pages/Insights'
import CostsPage from './pages/Costs'
import LoginPage, { clearStudentSession, clearTeacherSession } from './components/auth/LoginPage'
import StudentView from './pages/Students/StudentView'

export default function App() {
  const activePage       = useStore(s => s.activePage)
  const activeStudent    = useStore(s => s.activeStudent)
  const setActiveStudent = useStore(s => s.setActiveStudent)
  const hydrated         = useStore(s => s.hydrated)
  const initStore        = useStore(s => s.initStore)

  // GitHub Pages: track which mode authenticated
  const [studentData, setStudentData] = useState(null)  // set after student login
  const [teacherData, setTeacherData] = useState(null)  // set after teacher login (decrypted db)

  // Load data from disk (dev) or localStorage (prod) before rendering
  useEffect(() => { initStore() }, [])

  // In dev mode, block render until async disk load completes
  if (!hydrated) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-[28px] mb-3">📊</div>
          <div className="text-[14px] font-semibold text-ink-2">Loading data…</div>
          <div className="text-[11px] text-ink-3 mt-1 font-mono">reading faculty-data.json</div>
        </div>
      </div>
    )
  }

  // ── Read-only (GitHub Pages) mode ──────────────────────────
  if (IS_READ_ONLY) {
    // Neither teacher nor student logged in → show unified login
    if (!teacherData && !studentData) {
      return (
        <LoginPage
          onTeacherLogin={setTeacherData}
          onStudentLogin={setStudentData}
        />
      )
    }

    // Teacher portal — full-dataset read-only view
    if (teacherData) {
      return (
        <TeacherPortal
          data={teacherData}
          onLogout={() => { clearTeacherSession(); setTeacherData(null) }}
        />
      )
    }

    // Student portal
    return (
      <StudentPortal
        data={studentData}
        onLogout={() => { clearStudentSession(); setStudentData(null) }}
      />
    )
  }

  // ── Faculty mode (localhost) ────────────────────────────────
  const pages = {
    dashboard: <DashboardPage />,
    exams:     <ExamsPage />,
    students:  <StudentsPage />,
    toppers:   <ToppersPage />,
    insights:  <InsightsPage />,
    costs:     <CostsPage />,
  }

  return (
    <ModeContext.Provider value="faculty">
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

// ── Teacher Portal ─────────────────────────────────────────────
// Receives already-decrypted data from LoginPage and renders the full sidebar layout.
function TeacherPortal({ data, onLogout }) {
  const loadRemoteData = useStore(s => s.loadRemoteData)
  const activePage     = useStore(s => s.activePage)

  useEffect(() => { loadRemoteData(data) }, [data])

  const pages = {
    dashboard: <DashboardPage />,
    exams:     <ExamsPage />,
    students:  <StudentsPage />,
    toppers:   <ToppersPage />,
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
                       transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
          >
            Logout
          </button>
        </div>

        {/* Student view — full StudentView component */}
        <div className="pt-[60px] pb-8 px-4 md:px-8 max-w-4xl mx-auto">
          <StudentView name={data.name} />
        </div>
      </div>
    </ModeContext.Provider>
  )
}
