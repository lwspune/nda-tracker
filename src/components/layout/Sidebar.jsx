import { useState } from 'react'
import useStore from '../../store/useStore'
import { IS_READ_ONLY, APP_NAME, APP_SUB } from '../../config'

const NAV = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'exams',     icon: '📝', label: 'Exams' },
  { id: 'students',  icon: '👤', label: 'Students' },
  { id: 'toppers',   icon: '🏆', label: 'Toppers', hideReadOnly: true },
  { id: 'insights',  icon: '🧠', label: 'Insights' },
  { id: 'costs',     icon: '💰', label: 'API Costs', hideReadOnly: true },
]

export default function Sidebar() {
  const activePage    = useStore(s => s.activePage)
  const setActivePage = useStore(s => s.setActivePage)
  const exams         = useStore(s => s.exams)
  const studentProfiles = useStore(s => s.studentProfiles)
  const [mobileOpen, setMobileOpen] = useState(false)

  const studentCount = new Set(
    exams.flatMap(e => e.students.map(s => s.name))
  ).size
  const profileCount = Object.values(studentProfiles)
    .filter((v, i, arr) => arr.findIndex(x => x.lwsId === v.lwsId) === i && v.lwsId)
    .length

  const visibleNav = NAV.filter(n => !(IS_READ_ONLY && n.hideReadOnly))

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
            className="absolute top-0 left-0 bottom-0 w-[260px] bg-sidebar flex flex-col py-7 pt-16"
            onClick={e => e.stopPropagation()}
          >
            <SidebarContent
              activePage={activePage}
              visibleNav={visibleNav}
              navigate={navigate}
              exams={exams}
              studentCount={studentCount}
              profileCount={profileCount}
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
            className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-all
              ${activePage === item.id
                ? 'text-indigo-300'
                : 'text-white/35 hover:text-white/60'
              }`}
          >
            <span className="text-[18px] leading-none">{item.icon}</span>
            <span className="text-[9px] font-semibold tracking-wide">{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  )
}

function SidebarContent({ activePage, visibleNav, navigate, exams, studentCount, profileCount }) {
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
        {IS_READ_ONLY && (
          <span className="inline-block mt-2 text-[9px] font-mono font-bold uppercase
                           tracking-widest text-indigo-300/50 border border-indigo-300/20
                           px-2 py-0.5 rounded-full">
            View Only
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

      {/* Footer stats */}
      <div className="px-5 pt-4 border-t border-white/[0.07]">
        <div className="text-[11px] font-mono text-indigo-300/30 leading-relaxed">
          <div>{exams.length} exam{exams.length !== 1 ? 's' : ''}</div>
          <div>{studentCount} student{studentCount !== 1 ? 's' : ''}</div>
          {profileCount > 0 && <div>{profileCount} profiles</div>}
        </div>
      </div>
    </>
  )
}
