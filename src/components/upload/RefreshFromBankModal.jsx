import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import { supabase } from '../../lib/supabase'
import { bankQuestionIds, fetchBankQuestions } from '../../lib/bankFetch'
import { hydrateQuestions } from '../../lib/bankHydrate'

// Pull question content from PYQ Vault into an exam that already exists here —
// above all the DIAGRAMS, which the text-only Tags sheet drops entirely.
//
// Deliberately NOT a one-click overwrite. The stored copy is the record of what
// the student actually sat, so this fills what is MISSING and only REPORTS what
// disagrees. Applying a correction stays a human decision made against a diff.
export default function RefreshFromBankModal({ exam, onClose }) {
  const replaceExam = useStore(s => s.replaceExam)
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function run() {
      const ids = bankQuestionIds(exam)
      if (ids.length === 0) {
        if (!cancelled) setState({ status: 'no-ids' })
        return
      }
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const { byId, missing } = await fetchBankQuestions(ids, { token: session?.access_token })
        const result = hydrateQuestions(exam.questions, byId)
        if (!cancelled) setState({ status: 'ready', ...result, missing: [...result.missing, ...missing] })
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: e.message })
      }
    }
    run()
    return () => { cancelled = true }
  }, [exam])

  function handleApply() {
    replaceExam(exam.id, { ...exam, questions: state.questions })
    onClose()
  }

  const fieldsFilled = state.filled?.length ?? 0
  const questionsTouched = new Set((state.filled || []).map(f => f.q)).size

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(15,18,45,0.55)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="bg-surface rounded-2xl shadow-lg w-[620px] max-w-[95vw] max-h-[90vh]
                   overflow-y-auto flex flex-col"
        style={{ animation: 'slideUp 0.22s cubic-bezier(0.4,0,0.2,1)' }}
      >
        <div className="flex items-center justify-between px-7 pt-6 pb-4 border-b border-border">
          <div>
            <h2 className="text-[17px] font-extrabold tracking-tight">🔄 Refresh from bank</h2>
            <p className="text-[12px] text-ink-3 mt-0.5">{exam.name} · {exam.date}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink-3 hover:text-ink text-[20px] leading-none transition-colors"
          >×</button>
        </div>

        <div className="px-7 py-5 flex-1">
          {state.status === 'loading' && (
            <p className="text-[13px] text-ink-3">Asking the question bank…</p>
          )}

          {state.status === 'no-ids' && (
            <p className="text-[13px] text-ink-2">
              This exam carries <strong>no bank ids</strong>, so there is nothing to pull. Only
              papers built in PYQ Vault (or re-tagged from a sheet it generated) can be refreshed.
            </p>
          )}

          {state.status === 'error' && (
            <div className="text-[13px] text-danger">
              <p className="font-semibold">Could not reach the question bank.</p>
              <p className="mt-1 text-ink-2">{state.message}</p>
              <p className="mt-2 text-[12px] text-ink-3">
                Nothing was changed. This is not the same as the bank having nothing for this exam.
              </p>
            </div>
          )}

          {state.status === 'ready' && (
            <div className="space-y-5 text-[13px]">
              <div>
                <p className="font-semibold text-ink">
                  {fieldsFilled > 0
                    ? `${fieldsFilled} field${fieldsFilled === 1 ? '' : 's'} to fill across ${questionsTouched} question${questionsTouched === 1 ? '' : 's'}`
                    : 'Nothing to fill — this exam already has everything the bank holds.'}
                </p>
                {fieldsFilled > 0 && (
                  <p className="text-[12px] text-ink-3 mt-1">
                    Only empty fields are filled. Diagrams are the usual find.
                  </p>
                )}
              </div>

              {state.differs?.length > 0 && (
                <div>
                  <p className="font-semibold text-warning">
                    {state.differs.length} field{state.differs.length === 1 ? '' : 's'} differs — not applied
                  </p>
                  <p className="text-[12px] text-ink-3 mt-0.5 mb-2">
                    The bank has changed since this paper was sat. What students saw is kept; fix
                    these by hand if the bank is right.
                  </p>
                  <ul className="space-y-1.5 max-h-[180px] overflow-y-auto">
                    {state.differs.map((d, i) => (
                      <li key={i} className="border border-border rounded-md px-2 py-1.5">
                        <span className="text-[11px] text-ink-3">Q{d.q} · {d.field}</span>
                        <div className="text-[12px] mt-0.5">
                          <span className="text-ink-3">here:</span> {String(d.stored).slice(0, 90)}
                        </div>
                        <div className="text-[12px]">
                          <span className="text-ink-3">bank:</span> {String(d.bank).slice(0, 90)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {state.missing?.length > 0 && (
                <div>
                  <p className="font-semibold text-ink-2">
                    {state.missing.length} question{state.missing.length === 1 ? '' : 's'} not
                    available from the bank
                  </p>
                  {/* Two indistinguishable causes — the id names no row, or it names another
                      institute's private row. Never claim a repair happened. */}
                  <p className="text-[12px] text-ink-3 mt-0.5">
                    The bank returned nothing for these ids. They may have been re-created there,
                    or they may not belong to this institute.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={onClose} className="btn btn-secondary">Cancel</button>
                <button
                  onClick={handleApply}
                  disabled={fieldsFilled === 0}
                  className="btn btn-primary disabled:opacity-50"
                >
                  ✓ Apply {fieldsFilled > 0 ? `${fieldsFilled} fill${fieldsFilled === 1 ? '' : 's'}` : ''}
                </button>
              </div>
            </div>
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
