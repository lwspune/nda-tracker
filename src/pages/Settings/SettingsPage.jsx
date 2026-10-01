import { useState } from 'react'
import { PageHeader } from '../../components/ui'
import BranchesTab from './BranchesTab'
import BatchesTab from './BatchesTab'
import TeachersTab from './TeachersTab'
import NdaWeightageTab from './NdaWeightageTab'
import MonitoringTab from './MonitoringTab'
import WhatsAppTab from './WhatsAppTab'
import MentorshipTab from './MentorshipTab'

const TABS = [
  { id: 'branches',  label: 'Branches' },
  { id: 'batches',   label: 'Batches' },
  { id: 'teachers',  label: 'Teachers' },
  { id: 'weightage', label: 'NDA Weightage' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'whatsapp',  label: 'WhatsApp' },
  { id: 'mentorship', label: 'Mentorship' },
]

export default function SettingsPage() {
  const [tab, setTab] = useState('branches')

  return (
    <div>
      <PageHeader title="Settings" sub="Manage branches, batches, teachers, and WhatsApp messages" />

      {/* Below md the row scrolls on its own instead of widening the page: seven
          tabs need ~690px. It is capped at the viewport less <main>'s p-4,
          because <main> is a flex child without min-w-0 and would otherwise
          grow to fit the row. The 1px overlap (-mb-px) is desktop-only: a
          scroll container clips it and shows a stray vertical scrollbar. */}
      <div className="flex gap-1 border-b border-border mb-6 max-md:overflow-x-auto max-md:max-w-[calc(100vw-2rem)]">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 md:-mb-px max-md:whitespace-nowrap max-md:shrink-0 transition-colors min-h-[44px] ${
              tab === t.id
                ? 'border-accent text-ink'
                : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'branches'  && <BranchesTab />}
      {tab === 'batches'   && <BatchesTab />}
      {tab === 'teachers'  && <TeachersTab />}
      {tab === 'weightage' && <NdaWeightageTab />}
      {tab === 'monitoring' && <MonitoringTab />}
      {tab === 'whatsapp'  && <WhatsAppTab onSwitchTab={setTab} />}
      {tab === 'mentorship' && <MentorshipTab />}
    </div>
  )
}
