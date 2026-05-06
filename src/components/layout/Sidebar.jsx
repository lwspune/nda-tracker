import { useState } from 'react'
import useStore from '../../store/useStore'
import { APP_NAME, APP_SUB } from '../../config'
import { useMode } from '../../context/ModeContext'

const NAV = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'exams',     icon: '📝', label: 'Exams' },
  { id: 'students',  icon: '👤', label: 'Students' },
  { id: 'toppers',   icon: '🏆', label: 'Toppers' },
  { id: 'syllabus',   icon: '📚', label: 'Syllabus' },
  { id: 'timetable', icon: '🗓', label: 'Timetable' },
  { id: 'insights',  icon: '🧠', label: 'Insights', facultyOnly: true },
  { id: 'costs',     icon: '💰', label: 'API Costs', facultyOnly: true },
]

// Returns true if exams exist that post-date the last deploy run.
function useIsStale() {
  const exams          = useStore(s => s.exams)
  const lastDeployedAt = useStore(s => s.lastDeployedAt)
  if (!exams.length) return false
  if (!lastDeployedAt) return true  // never deployed
  const deployDate = lastDeployedAt.slice(0, 10) // YYYY-MM-DD
  return exams.some(e => e.date > deployDate)
}

export default function Sidebar({ onLogout }) {
  const activePage    = useStore(s => s.activePage)
  const setActivePage = useStore(s => s.setActivePage)
  const exams         = useStore(s => s.exams)
  const studentProfiles = useStore(s => s.studentProfiles)
  const [mobileOpen, setMobileOpen] = useState(false)
  const isStale = useIsStale()
  const mode = useMode()

  const studentCount = new Set(
    exams.flatMap(e => e.students.map(s => s.name))
  ).size
  const profileCount = Object.values(studentProfiles)
    .filter((v, i, arr) => arr.findIndex(x => x.lwsId === v.lwsId) === i && v.lwsId)
    .length

  const visibleNav = NAV.filter(n => !(mode !== 'faculty' && n.facultyOnly))

  function navigate(id) {
    setActivePage(id)
    setMobileOpen(false)
  }

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside className="hidden md:flex fixed top-0 left-0 bottom-0 w-[228px] bg-sidebar flex-col py-7 z-50">
        <SidebarContent
          activePage={activePage}
          visibleNav={visibleNav}
          navigate={navigate}
          exams={exams}
          studentCount={studentCount}
          profileCount={profileCount}
          isStale={isStale}
          mode={mode}
          onLogout={onLogout}
        />
      </aside>

      {/* ── Mobile top bar ──────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-sidebar border-b border-white/[0.07]
                      flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-[15px] font-extrabold text-indigo-300 tracking-tight">{APP_NAME}</div>
          <div className="text-[9px] font-mono text-indigo-300/30 tracking-[1.5px] uppercase">{APP_SUB}</div>
        </div>
        <button
          onClick={() => setMobileOpen(o => !o)}
          className="text-indigo-300/70 hover:text-indigo-300 p-1.5 rounded-lg
                     hover:bg-white/10 transition-colors"
          aria-label="Menu"
        >
          {mobileOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Mobile drawer ───────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside
            className="absolute top-0 left-0 bottom-0 w-[min(85vw,260px)] bg-sidebar flex flex-col py-7 pt-16"
            onClick={e => e.stopPropagation()}
          >
            <SidebarContent
              activePage={activePage}
              visibleNav={visibleNav}
              navigate={navigate}
              exams={exams}
              studentCount={studentCount}
              profileCount={profileCount}
              isStale={isStale}
              mode={mode}
              onLogout={onLogout}
            />
          </aside>
        </div>
      )}

      {/* ── Mobile bottom nav ───────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-white/[0.07]
                      flex items-center justify-around px-2 py-1 safe-area-bottom">
        {visibleNav.map(item => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            className={`flex flex-col items-center gap-0.5 px-3 py-3 rounded-lg transition-all min-h-[44px]
              ${activePage === item.id
                ? 'text-indigo-300'
                : 'text-white/35 hover:text-white/60'
              }`}
          >
            <span className="text-[18px] leading-none">{item.icon}</span>
            <span className="text-[10px] font-semibold tracking-wide">{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  )
}

function SidebarContent({ activePage, visibleNav, navigate, exams, studentCount, profileCount, isStale, mode, onLogout }) {
  return (
    <>
      {/* Logo */}
      <div className="px-5 pb-6 border-b border-white/[0.07] mb-5">
        <div className="text-[17px] font-extrabold text-indigo-300 tracking-tight leading-snug">
          {APP_NAME}
        </div>
        <div className="text-[10px] font-mono text-indigo-300/30 tracking-[1.5px] uppercase mt-1">
          {APP_SUB}
        </div>
        {mode !== 'faculty' && (
          <span className="inline-block mt-2 text-[9px] font-mono font-bold uppercase
                           tracking-widest text-indigo-300/50 border border-indigo-300/20
                           px-2 py-0.5 rounded-full">
            {mode === 'teacher' ? 'Teacher View' : 'View Only'}
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2">
        <div className="text-[9.5px] font-mono uppercase tracking-[1.8px] text-indigo-300/25 px-3 mb-2">
          Navigation
        </div>
        {visibleNav.map(item => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            className={`
              w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg mb-0.5
              text-[13px] font-medium transition-all duration-150 border-l-2 text-left
              ${activePage === item.id
                ? 'text-indigo-300 bg-indigo-300/10 border-indigo-300'
                : 'text-white/40 border-transparent hover:text-white/75 hover:bg-white/5'
              }
            `}
          >
            <span className="text-[15px]">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Stale data warning — faculty mode only */}
      {mode === 'faculty' && isStale && (
        <div className="mx-3 mb-3 px-3 py-2.5 rounded-lg bg-yellow-400/10 border border-yellow-400/30">
          <div className="text-[10px] font-bold text-yellow-300 uppercase tracking-wide mb-1">
            ⚠️ Students out of date
          </div>
          <div className="text-[10px] text-yellow-300/70 leading-snug">
            New exams haven't been deployed. Run:
          </div>
          <div className="mt-1.5 font-mono text-[10px] bg-black/30 rounded px-2 py-1 text-yellow-200 select-all">
            npm run deploy
          </div>
        </div>
      )}

      {/* Footer stats + teacher logout */}
      <div className="px-5 pt-4 border-t border-white/[0.07]">
        <div className="text-[11px] font-mono text-indigo-300/30 leading-relaxed">
          <div>{exams.length} exam{exams.length !== 1 ? 's' : ''}</div>
          <div>{studentCount} student{studentCount !== 1 ? 's' : ''}</div>
          {profileCount > 0 && <div>{profileCount} profiles</div>}
        </div>
        {mode === 'teacher' && onLogout && (
          <button
            onClick={onLogout}
            className="mt-3 w-full text-left text-[11px] font-semibold text-indigo-300/40
                       hover:text-indigo-300 transition-colors"
          >
            ← Logout
          </button>
        )}
      </div>
    </>
  )
}
