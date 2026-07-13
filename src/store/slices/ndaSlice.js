import { buildDefaultFreqBySubject } from '../../lib/ndaFreq'

export const createNdaSlice = (set, get) => ({
  // Sets freq rows for a specific subject
  setNdaFreq(subject, rows) {
    set(s => ({ ndaFreqBySubject: { ...s.ndaFreqBySubject, [subject]: rows } }))
    get()._save()
  },

  // Resets a specific subject's freq to its default
  resetNdaFreq(subject) {
    const defaults = buildDefaultFreqBySubject()
    set(s => ({ ndaFreqBySubject: { ...s.ndaFreqBySubject, [subject]: defaults[subject] || [] } }))
    get()._save()
  },

  // Sets the total NDA marks for a specific subject (GAT excluded — always derived)
  setSubjectTotalMarks(subject, marks) {
    set(s => ({ ndaMarksBySubject: { ...s.ndaMarksBySubject, [subject]: marks } }))
    get()._save()
  },

  recordCost(entry) {
    set(s => ({ costLog: [...s.costLog, entry] }))
    get()._save()
  },

  clearCostLog() {
    set({ costLog: [] })
    get()._save()
  },
})
