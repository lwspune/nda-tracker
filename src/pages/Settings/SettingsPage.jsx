import { useState } from 'react'
import { PageHeader } from '../../components/ui'
import BranchesTab from './BranchesTab'
import BatchesTab from './BatchesTab'
import TeachersTab from './TeachersTab'
import NdaWeightageTab from './NdaWeightageTab'
import MonitoringTab from './MonitoringTab'

const TABS = [
  { id: 'branches',  label: 'Branches' },
  { id: 'batches',   label: 'Batches' },
  { id: 'teachers',  label: 'Teachers' },
  { id: 'weightage', label: 'NDA Weightage' },
  { id: 'monitoring', label: 'Monitoring' },
]

export default function SettingsPage() {
  const [tab, setTab] = useState('branches')

  return (
    <div>
      <PageHeader title="Settings" sub="Manage branches, batches, and teachers" />

      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors min-h-[44px] ${
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
    </div>
  )
}
