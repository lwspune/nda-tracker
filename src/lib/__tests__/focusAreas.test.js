import { describe, it, expect } from 'vitest'
import { buildFocusAreas } from '../focusAreas'

// C → B → A (C needs B needs A). D stands alone.
const TOY = { B: ['A'], C: ['B'], D: [] }

describe('buildFocusAreas — student "where to focus" view-model', () => {
  it('groups weak chapters under their deepest root cause', () => {
    const breakdown = [
      { chapter: 'A', accuracy: 0.2 },
      { chapter: 'B', accuracy: 0.3 },
      { chapter: 'C', accuracy: 0.4 },
      { chapter: 'D', accuracy: 0.9 },
    ]
    const fa = buildFocusAreas({ breakdown, subject: 'Maths', graph: TOY })
    expect(fa.startHere.length).toBe(1)
    expect(fa.startHere[0].chapter).toBe('A')
    expect(fa.startHere[0].from).toEqual(expect.arrayContaining(['B', 'C']))
  })

  it('builds a chapter-level Learn + Practice link for each root chapter', () => {
    const breakdown = [{ chapter: 'A', accuracy: 0.2 }]
    const fa = buildFocusAreas({ breakdown, subject: 'Maths', graph: TOY })
    expect(fa.startHere[0].learnUrl).toContain('/go/learn?chapter=A')
    expect(fa.startHere[0].practiceUrl).toContain('/go/practice?')
    expect(fa.startHere[0].practiceUrl).toContain('chapter=A')
    expect(fa.startHere[0].practiceUrl).toContain('subject=Maths')
  })

  it('shows the chapter-level Practice link even with no logged weak subtopics', () => {
    const breakdown = [{ chapter: 'A', accuracy: 0.2 }]
    const fa = buildFocusAreas({ breakdown, subject: 'Maths', graph: TOY })
    expect(fa.startHere[0].practiceUrl).toContain('chapter=A')
  })

  it('omits the Practice link for subjects with no practice bank (but keeps Learn)', () => {
    const breakdown = [{ chapter: 'A', accuracy: 0.2 }]
    const fa = buildFocusAreas({ breakdown, subject: 'English', graph: TOY })
    expect(fa.startHere[0].practiceUrl).toBeNull()
    expect(fa.startHere[0].learnUrl).toContain('/go/learn?chapter=A')
  })

  it('lists the ready-to-learn frontier (prereqs mastered, chapter not yet mastered)', () => {
    const breakdown = [
      { chapter: 'A', accuracy: 0.9 },   // mastered
      { chapter: 'B', accuracy: 0.4 },   // ready — prereq A mastered
      { chapter: 'C', accuracy: null },  // blocked — prereq B not mastered
    ]
    const fa = buildFocusAreas({ breakdown, subject: 'Maths', graph: TOY })
    expect(fa.readyToLearn).toContain('B')
    expect(fa.readyToLearn).not.toContain('C')
    expect(fa.readyToLearn).not.toContain('A')
  })

  it('returns empty startHere when nothing is weak', () => {
    const breakdown = [{ chapter: 'A', accuracy: 0.9 }]
    const fa = buildFocusAreas({ breakdown, subject: 'Maths', graph: TOY })
    expect(fa.startHere).toEqual([])
  })
})
