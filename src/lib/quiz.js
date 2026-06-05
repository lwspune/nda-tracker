// Pure helpers for the Daily Quiz feature.
// Quiz objects use the same camelCase + questions[] shape as exams, so all the
// existing question rendering reuses. Grading is intentionally pure so it can be
// reused verbatim by the server-side grader (api/quiz-submit.js, Phase 2).

export const LETTERS = ['A', 'B', 'C', 'D']
export const DIFFICULTIES = ['Easy', 'Moderate', 'Hard']
export const DEFAULT_MARKING = { correct: 1, wrong: 0 }

const OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD']

// A fresh, empty question shell for the authoring form.
export function blankQuestion(qNum) {
  return {
    q: qNum,
    question: '',
    optionA: '', optionB: '', optionC: '', optionD: '',
    answer: '',
    chapter: '', subtopic: '', difficulty: '',
  }
}

// A question is "complete" (publishable) when it has text, all four options,
// and a correct answer letter A–D.
export function quizQuestionComplete(q) {
  if (!q) return false
  const hasText = !!(q.question && String(q.question).trim())
  const hasOptions = OPTION_KEYS.every(k => q[k] && String(q[k]).trim())
  const hasAnswer = LETTERS.includes(String(q.answer || '').toUpperCase())
  return hasText && hasOptions && hasAnswer
}

// Derived lifecycle state. Stored status is only 'draft' | 'published';
// 'open' vs 'closed' is derived from closesAt at read time.
export function quizStatus(quiz, nowMs = Date.now()) {
  if (!quiz || quiz.status !== 'published') return 'draft'
  const closes = quiz.closesAt ? new Date(quiz.closesAt).getTime() : null
  if (closes !== null && nowMs >= closes) return 'closed'
  return 'open'
}

// Guard run before flipping a quiz to 'published'.
export function validateQuizForPublish(quiz, nowMs = Date.now()) {
  if (!quiz) return { ok: false, reason: 'missing' }
  if (!quiz.title || !String(quiz.title).trim()) return { ok: false, reason: 'title_required' }
  const complete = (quiz.questions || []).filter(quizQuestionComplete)
  if (complete.length === 0) return { ok: false, reason: 'no_complete_questions' }
  if (!quiz.closesAt) return { ok: false, reason: 'close_time_required' }
  if (new Date(quiz.closesAt).getTime() <= nowMs) return { ok: false, reason: 'close_time_past' }
  return { ok: true }
}

// Grade a set of chosen letters against the answer key.
// answers: { [qNum]: 'A'|'B'|'C'|'D' }. Returns counts + score + a 1/-1/0
// responses map (same encoding as exam_results.responses) for downstream analytics.
export function gradeQuizAttempt(questions, answers, marking = DEFAULT_MARKING) {
  const correctMark = marking?.correct ?? DEFAULT_MARKING.correct
  const wrongMark = marking?.wrong ?? DEFAULT_MARKING.wrong
  let correct = 0, incorrect = 0, notAttempted = 0
  const responses = {}
  for (const q of questions || []) {
    const key = String(q.q)
    const chosen = String(answers?.[key] ?? '').toUpperCase()
    const right = String(q.answer ?? '').toUpperCase()
    if (!chosen) { notAttempted++; responses[key] = 0; continue }
    if (chosen === right) { correct++; responses[key] = 1 }
    else { incorrect++; responses[key] = -1 }
  }
  const score = correct * correctMark + incorrect * wrongMark
  return { correct, incorrect, notAttempted, score, responses }
}

// Remove the answer key before sending questions to a student who hasn't
// submitted yet (Phase 2). Pure so it can be shared by the serverless endpoint.
export function stripAnswerKey(questions) {
  return (questions || []).map(({ answer: _a, solution: _s, ...rest }) => rest)
}
