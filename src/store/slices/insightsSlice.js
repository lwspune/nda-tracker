export const createInsightsSlice = (set, get) => ({
  saveClassReport(text) {
    set(s => ({
      savedInsights: {
        ...s.savedInsights,
        classReport: { text, generatedAt: new Date().toISOString() }
      }
    }))
    get()._save()
  },

  saveStudentPlan(name, text) {
    set(s => ({
      savedInsights: {
        ...s.savedInsights,
        studentPlans: {
          ...s.savedInsights.studentPlans,
          [name]: { text, generatedAt: new Date().toISOString() }
        }
      }
    }))
    get()._save()
  },

  clearClassReport() {
    set(s => ({
      savedInsights: { ...s.savedInsights, classReport: null }
    }))
    get()._save()
  },

  clearStudentPlan(name) {
    set(s => {
      const plans = { ...s.savedInsights.studentPlans }
      delete plans[name]
      return { savedInsights: { ...s.savedInsights, studentPlans: plans } }
    })
    get()._save()
  },
})
