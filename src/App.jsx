import { useEffect } from 'react'
import useStore from './store/useStore'
import { IS_READ_ONLY, REMOTE_DATA_URL } from './config'
import Sidebar from './components/layout/Sidebar'
import ApiBar from './components/layout/ApiBar'
import UploadModal from './components/upload/UploadModal'
import ExamsPage from './pages/Exams'
import DashboardPage from './pages/Dashboard'
import StudentsPage from './pages/Students'
import ToppersPage from './pages/Toppers'
import InsightsPage from './pages/Insights'
import CostsPage from './pages/Costs'

export default function App() {
  const activePage    = useStore(s => s.activePage)
  const loadRemoteData = useStore(s => s.loadRemoteData)

  useEffect(() => {
    if (IS_READ_ONLY) {
      fetch(REMOTE_DATA_URL)
        .then(r => r.json())
        .then(loadRemoteData)
        .catch(e => console.warn('Could not load remote data:', e))
    }
  }, [])

  const pages = {
    dashboard: <DashboardPage />,
    exams:     <ExamsPage />,
    students:  <StudentsPage />,
    toppers:   <ToppersPage />,
    insights:  <InsightsPage />,
    costs:     <CostsPage />,
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />

      {/* Main content
          Desktop: offset by sidebar width (ml-[228px])
          Mobile:  no offset, padding-top for header, padding-bottom for bottom nav */}
      <div className="
        flex-1 flex flex-col min-h-screen
        md:ml-[228px]
        pt-[56px] md:pt-0
        pb-[60px] md:pb-0
      ">
        {/* ApiBar — desktop only */}
        <div className="hidden md:block">
          <ApiBar />
        </div>

        <main className="flex-1 p-4 md:p-8 md:pt-7">
          {pages[activePage] ?? <DashboardPage />}
        </main>
      </div>

      <UploadModal />
    </div>
  )
}
