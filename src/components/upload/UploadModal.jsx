import { useState } from 'react'
import useStore from '../../store/useStore'
import Step1Upload from './Step1Upload'
import Step2Review from './Step2Review'
import Step3Tags from './Step3Tags'
import Step4Confirm from './Step4Confirm'

const STEPS = [
  '1 · Upload Files',
  '2 · Review Details',
  '3 · Tag Questions',
  '4 · Confirm',
]

export default function UploadModal() {
  const open = useStore(s => s.uploadModalOpen)
  const close = useStore(s => s.closeUploadModal)
  const addExam = useStore(s => s.addExam)

  const [step, setStep] = useState(1)
  const [state, setState] = useState({})

  function reset() {
    setStep(1)
    setState({})
  }

  function handleClose() {
    reset()
    close()
  }

  function handleSave(exam) {
    if (exam !== null) {
      addExam(exam)
    }
    // null means exam was already saved via replaceExam — just close
    handleClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={e => {
        if (e.target !== e.currentTarget) return
        if (step > 1) {
          if (confirm('Close and discard this exam upload? All progress will be lost.')) handleClose()
        } else {
          handleClose()
        }
      }}
    >
      <div
        className="bg-surface rounded-2xl shadow-lg w-[620px] max-w-[95vw] max-h-[90vh]
                   overflow-y-auto flex flex-col"
        style={{ animation: 'slideUp 0.22s cubic-bezier(0.4,0,0.2,1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-6 pb-0">
          <h2 className="text-[18px] font-extrabold tracking-tight">Add Exam</h2>
          <button
            onClick={handleClose}
            className="text-ink-3 hover:text-ink text-[20px] leading-none transition-colors"
          >×</button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1.5 px-7 mt-5 mb-6">
          {STEPS.map((label, i) => {
            const n = i + 1
            const done   = n < step
            const active = n === step
            return (
              <div
                key={n}
                className={`flex-1 text-center py-2 rounded-lg text-[10px] font-bold uppercase
                            tracking-[0.8px] transition-all border
                  ${done   ? 'bg-green-50 text-success border-green-200' :
                    active ? 'bg-accent-soft text-accent border-accent/25' :
                             'bg-surface-2 text-ink-3 border-transparent'}`}
              >
                {done ? '✓ ' : ''}{label}
              </div>
            )
          })}
        </div>

        {/* Step content */}
        <div className="px-7 pb-7 flex-1">
          {step === 1 && (
            <Step1Upload
              onNext={data => { setState(data); setStep(2) }}
              onCancel={handleClose}
            />
          )}
          {step === 2 && (
            <Step2Review
              state={state}
              onChange={patch => setState(s => ({ ...s, ...patch }))}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <Step3Tags
              state={state}
              onChange={patch => setState(s => ({ ...s, ...patch }))}
              onNext={() => setStep(4)}
              onBack={() => setStep(2)}
            />
          )}
          {step === 4 && (
            <Step4Confirm
              state={state}
              onSave={handleSave}
              onBack={() => setStep(3)}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(16px) scale(0.98); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
