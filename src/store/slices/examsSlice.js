export const createExamsSlice = (set, get) => ({
  addExam(exam) {
    set(s => ({ exams: [...s.exams, { ...exam, batch: exam.batch || null, branch: exam.branch || null }] }))
    get()._save()
  },

  replaceExam(id, exam) {
    set(s => ({ exams: s.exams.map(e => e.id === id ? exam : e) }))
    get()._save()
  },

  deleteExam(id) {
    set(s => ({ exams: s.exams.filter(e => e.id !== id) }))
    get()._save()
  },

  updateQuestion(examId, qNum, patch) {
    set(s => ({
      exams: s.exams.map(e => {
        if (e.id !== examId) return e
        return {
          ...e,
          questions: e.questions.map(q =>
            q.q === qNum ? { ...q, ...patch } : q
          )
        }
      })
    }))
    get()._save()
  },
})
