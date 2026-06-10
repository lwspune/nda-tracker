// ── Pure helpers for ChapterAccordion ────────────────────────

// Format date from YYYY-MM-DD to "Mar 21" or "Mar 21, 2026"
export function fmtDate(dateStr, includeYear = false) {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    const mon = d.toLocaleString('en-IN', { month: 'short' })
    const day = d.getDate()
    return includeYear ? `${mon} ${day}, ${d.getFullYear()}` : `${mon} ${day}`
  } catch { return dateStr }
}

// Returns { wrong: [{qObj, examName, examDate, examId, studentResult, studentAnswer}], skipped: [...] }
// studentAnswer = the chosen letter from exam_results.choices (null for skipped
// or exams uploaded before choice capture).
export function getSubtopicQuestions(ch, sub, name, exams) {
  const wrong = []
  const skipped = []
  exams.forEach(exam => {
    const student = exam.students.find(s => s.name === name)
    if (!student) return
    exam.questions.forEach(q => {
      if (q.chapter !== ch || q.subtopic !== sub) return
      const resp = student.responses?.[q.q]
      const studentAnswer = student.choices?.[q.q] ?? null
      const base = { qObj: q, examName: exam.name, examDate: exam.date, examId: exam.id }
      if (resp === -1) {
        wrong.push({ ...base, studentResult: -1, studentAnswer })
      } else if (resp === 0) {
        skipped.push({ ...base, studentResult: 0, studentAnswer })
      }
    })
  })
  return { wrong, skipped }
}

// Group an array of question items by examName + examDate
export function groupByExam(qs) {
  const map = {}
  qs.forEach(item => {
    const key = `${item.examName}||${item.examDate}`
    if (!map[key]) map[key] = { examName: item.examName, examDate: item.examDate, examId: item.examId, items: [] }
    map[key].items.push(item)
  })
  return Object.values(map)
}
