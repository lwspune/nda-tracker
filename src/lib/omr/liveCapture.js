// Deciding, frame by frame, when a sheet under the lens has actually been read.
//
// Evalbee gives its verdict in the viewfinder rather than after a photograph,
// and that is the whole difference between scanning a stack and photographing
// one. The reading itself was always fast enough — what a live scanner needs on
// top is a rule for WHEN to commit, and that rule is what lives here.
//
// A pure reducer, so the rule is testable without a camera: every judgement the
// scanner makes is `liveStep(state, result)`, where `result` is whatever
// `readSheetImage` returned for one frame.
//
// Three things it refuses to do:
//   • file a sheet off ONE frame — a hand moving across the paper or a band of
//     glare changes an answer without changing anything a human would notice, so
//     two consecutive frames must agree EXACTLY, roll included;
//   • file the same sheet again while it sits under the lens — it has to leave
//     the frame first, which is also the operator's natural motion;
//   • file anything still needing a human. A flagged question or an unreadable
//     roll is a decision, and nobody makes decisions through a viewfinder with
//     both hands full of paper. Those are handed to the review list instead.

/** Two reads of the same filled sheet give the same string; anything else differs. */
export function sheetSignature(result) {
  if (!result?.ok) return null
  const answers = Object.keys(result.answers || {})
    .sort((a, b) => Number(a) - Number(b))
    .map(q => `${q}:${result.answers[q] || '-'}`)
    .join(',')
  return `${result.roll?.digits || '-'}|${answers}`
}

export const liveInitial = () => ({
  // The candidate being confirmed, and how many consecutive frames have agreed.
  pending: null,
  agree: 0,
  // Consecutive frames with no readable sheet. The sheet must go away before the
  // next one can be taken, and one dropped frame is not the sheet going away.
  gone: 0,
  // Signature of what is currently under the lens and already filed.
  held: null,
  // Students filed in this session — the same person twice means one of the two
  // sheets belongs to somebody else.
  acceptedIds: [],
})

const HOLD = 'Hold still…'

/**
 * @param {object} state       from `liveInitial`, then threaded through
 * @param {object} result      one frame, as `readSheetImage` returned it
 * @param {object} [opts]
 * @param {number} [opts.minAgree=2]     consecutive identical reads before filing
 * @param {number} [opts.clearFrames=3]  empty frames before the next sheet counts
 * @returns {{state:object, accept:object|null, phase:string, message:string}}
 */
export function liveStep(state, result, { minAgree = 2, clearFrames = 3 } = {}) {
  const s = state || liveInitial()

  // ── Nothing readable in this frame.
  if (!result?.ok) {
    const gone = s.gone + 1
    const cleared = gone >= clearFrames
    return {
      state: {
        ...s,
        gone,
        // Only once it is properly gone: a single dropped frame must not rearm
        // the scanner on a sheet that never moved.
        pending: cleared ? null : s.pending,
        agree: cleared ? 0 : s.agree,
        held: cleared ? null : s.held,
      },
      accept: null,
      phase: 'hunting',
      message: result?.reason || 'Point the camera at a sheet.',
    }
  }

  const signature = sheetSignature(result)

  // ── The sheet already filed, still under the lens.
  if (s.held && s.held === signature) {
    return { state: { ...s, gone: 0 }, accept: null, phase: 'done', message: 'Filed — next sheet.' }
  }

  // ── Read, but not decided. Handed to the review list by the caller, never
  //    auto-filed: this is the one place a human is required.
  if (!result.complete) {
    const why = result.student?.review
      ? (result.student.reason || result.roll?.reason || 'Whose sheet is this?')
      : `${result.reviewCount} question${result.reviewCount === 1 ? '' : 's'} to check`
    return { state: { ...s, gone: 0, pending: null, agree: 0 }, accept: null, phase: 'review', message: why }
  }

  // ── A student already filed in this session.
  const lwsId = result.student?.lwsId || null
  if (lwsId && s.acceptedIds.includes(lwsId)) {
    return {
      state: { ...s, gone: 0, pending: null, agree: 0 },
      accept: null,
      phase: 'duplicate',
      message: 'That student is already scanned — is this the same sheet?',
    }
  }

  // ── Confirming.
  const agree = s.pending === signature ? s.agree + 1 : 1
  if (agree < minAgree) {
    return {
      state: { ...s, gone: 0, pending: signature, agree },
      accept: null,
      phase: 'holding',
      message: HOLD,
    }
  }

  return {
    state: {
      ...s,
      gone: 0,
      pending: null,
      agree: 0,
      held: signature,
      acceptedIds: lwsId ? [...s.acceptedIds, lwsId] : s.acceptedIds,
    },
    accept: result,
    phase: 'accepted',
    message: 'Got it.',
  }
}
