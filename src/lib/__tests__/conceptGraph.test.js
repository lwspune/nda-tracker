import { describe, it, expect } from 'vitest'
import { NDA_FREQ_BY_SUBJECT } from '../ndaFreq'
import {
  CHAPTER_PREREQS,
  validateConceptGraph,
  getRootCauseChain,
  getReadyToLearn,
  rootCauseMap,
} from '../conceptGraph'

const CANONICAL = NDA_FREQ_BY_SUBJECT.Maths.map(r => r.chapter)

// A small synthetic DAG used to pin traversal semantics deterministically,
// independent of the real (curatable) CHAPTER_PREREQS content.
//   A → B → C   (C needs B needs A);  D stands alone.
const TOY = { B: ['A'], C: ['B'], D: [] }

describe('conceptGraph — data shape (locks the DAG contract)', () => {
  it('every node (key and prerequisite) is a canonical NDA Maths chapter', () => {
    const { unknownNodes } = validateConceptGraph(CHAPTER_PREREQS, CANONICAL)
    expect(unknownNodes).toEqual([])
  })

  it('the real prerequisite graph is acyclic', () => {
    const { cycles } = validateConceptGraph(CHAPTER_PREREQS, CANONICAL)
    expect(cycles).toEqual([])
  })

  it('detects a cycle when one exists', () => {
    const cyclic = { A: ['B'], B: ['A'] }
    const { cycles } = validateConceptGraph(cyclic, ['A', 'B'])
    expect(cycles.length).toBeGreaterThan(0)
  })

  it('flags a prerequisite that is not a canonical chapter', () => {
    const bad = { Functions: ['Made Up Chapter'] }
    const { unknownNodes } = validateConceptGraph(bad, CANONICAL)
    expect(unknownNodes).toContain('Made Up Chapter')
  })
})

describe('getRootCauseChain — deepest weak ancestor', () => {
  it('traces a weak chapter down to its deepest weak prerequisite', () => {
    const acc = { A: 0.2, B: 0.3, C: 0.4, D: 0.9 }
    const chain = getRootCauseChain(acc, { threshold: 0.5, graph: TOY })
    const c = chain.find(x => x.chapter === 'C')
    expect(c.root).toBe('A')
  })

  it('marks a weak chapter with no weak prerequisites as its own root', () => {
    const acc = { A: 0.2, B: 0.3, C: 0.4, D: 0.9 }
    const chain = getRootCauseChain(acc, { threshold: 0.5, graph: TOY })
    const a = chain.find(x => x.chapter === 'A')
    expect(a.root).toBe('A')
    expect(a.isRoot).toBe(true)
  })

  it('stops the chain at a strong prerequisite', () => {
    // B is strong, so C's root is C itself (its only prereq path is not weak)
    const acc = { A: 0.2, B: 0.9, C: 0.3, D: 0.9 }
    const chain = getRootCauseChain(acc, { threshold: 0.5, graph: TOY })
    const c = chain.find(x => x.chapter === 'C')
    expect(c.root).toBe('C')
  })

  it('ignores untested (null) chapters — unknown is not weak', () => {
    const acc = { A: null, B: 0.3, C: 0.4, D: 0.9 }
    const chain = getRootCauseChain(acc, { threshold: 0.5, graph: TOY })
    expect(chain.some(x => x.chapter === 'A')).toBe(false)
    // B is weak, A is untested → B is its own root (no *weak* prereq)
    const b = chain.find(x => x.chapter === 'B')
    expect(b.root).toBe('B')
  })

  it('is cycle-safe (does not infinite-loop on a bad graph)', () => {
    const acc = { A: 0.2, B: 0.3 }
    const chain = getRootCauseChain(acc, { threshold: 0.5, graph: { A: ['B'], B: ['A'] } })
    expect(Array.isArray(chain)).toBe(true)
  })
})

describe('getReadyToLearn — unlockable frontier', () => {
  it('returns not-yet-mastered chapters whose prerequisites are all mastered', () => {
    const acc = { A: 0.9, B: 0.4, C: null }
    const ready = getReadyToLearn(acc, { masteredThreshold: 0.7, graph: TOY })
    const names = ready.map(r => r.chapter)
    expect(names).toContain('B')   // prereq A mastered, B not mastered
    expect(names).not.toContain('C') // prereq B not mastered
    expect(names).not.toContain('A') // already mastered
  })

  it('treats a prerequisite-free chapter as ready when not mastered', () => {
    const acc = { A: 0.3 }
    const ready = getReadyToLearn(acc, { masteredThreshold: 0.7, graph: TOY })
    expect(ready.map(r => r.chapter)).toContain('A')
  })
})

describe('rootCauseMap — priority/projection rows → annotation map', () => {
  it('maps each weak chapter to its deeper weak prerequisite, omitting self-roots', () => {
    const rows = [
      { chapter: 'A', accuracy: 0.2, tested: true },
      { chapter: 'B', accuracy: 0.3, tested: true },
      { chapter: 'C', accuracy: 0.4, tested: true },
    ]
    const map = rootCauseMap(rows, { threshold: 0.5, graph: TOY })
    expect(map.C).toBe('A')
    expect(map.B).toBe('A')
    expect(map.A).toBeUndefined() // A is its own root — nothing deeper to point at
  })

  it('ignores untested rows (accuracy null)', () => {
    const rows = [
      { chapter: 'A', accuracy: null, tested: false },
      { chapter: 'B', accuracy: 0.3, tested: true },
    ]
    const map = rootCauseMap(rows, { threshold: 0.5, graph: TOY })
    expect(map.B).toBeUndefined() // A untested → B has no *weak* prereq → self-root
  })
})
