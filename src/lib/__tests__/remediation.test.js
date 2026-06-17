import { describe, it, expect } from 'vitest'
import {
  PYQVAULT_URL,
  hasPracticeBank,
  buildLearnUrl,
  buildPracticeUrl,
  distinctSubtopics,
  remediationLinks,
  practiceMistakesUrl,
  examLearnUrl,
  examPracticeUrl,
  examRemediationLinks,
} from '../remediation.js'

const q = (subtopic, conceptSlug) => ({ q: 1, question: 'x', subtopic, conceptSlug })

describe('hasPracticeBank', () => {
  it('is true for Maths, false otherwise', () => {
    expect(hasPracticeBank('Maths')).toBe(true)
    expect(hasPracticeBank('Physics')).toBe(false)
    expect(hasPracticeBank('')).toBe(false)
    expect(hasPracticeBank(undefined)).toBe(false)
  })
  it('trims whitespace', () => {
    expect(hasPracticeBank('  Maths ')).toBe(true)
  })
})

describe('buildLearnUrl', () => {
  it('includes subtopic + concept when both present', () => {
    const url = buildLearnUrl(q('vectors-dot-product', 'dot-product'))
    expect(url).toBe(
      `${PYQVAULT_URL}/go/learn?subtopic=vectors-dot-product&concept=dot-product`
    )
  })
  it('works with subtopic only', () => {
    expect(buildLearnUrl(q('vectors-dot-product', undefined))).toBe(
      `${PYQVAULT_URL}/go/learn?subtopic=vectors-dot-product`
    )
  })
  it('works with concept only', () => {
    expect(buildLearnUrl(q(undefined, 'dot-product'))).toBe(
      `${PYQVAULT_URL}/go/learn?concept=dot-product`
    )
  })
  it('returns null with no provenance', () => {
    expect(buildLearnUrl(q(undefined, undefined))).toBeNull()
    expect(buildLearnUrl(null)).toBeNull()
  })
})

describe('buildPracticeUrl', () => {
  it('appends one subtopic param per slug', () => {
    expect(buildPracticeUrl(['a', 'b'])).toBe(
      `${PYQVAULT_URL}/go/practice?subtopic=a&subtopic=b`
    )
  })
  it('drops falsy entries and returns null when empty', () => {
    expect(buildPracticeUrl([null, '', undefined])).toBeNull()
    expect(buildPracticeUrl([])).toBeNull()
  })
})

describe('distinctSubtopics', () => {
  it('dedupes preserving first-seen order', () => {
    const qs = [q('a'), q('b'), q('a'), q(undefined), q('c')]
    expect(distinctSubtopics(qs)).toEqual(['a', 'b', 'c'])
  })
  it('handles empty input', () => {
    expect(distinctSubtopics([])).toEqual([])
    expect(distinctSubtopics(undefined)).toEqual([])
  })
})

describe('remediationLinks', () => {
  it('gives both links for a Maths question with provenance', () => {
    const { learnUrl, practiceUrl } = remediationLinks(
      q('vectors-dot-product', 'dot-product'),
      'Maths'
    )
    expect(learnUrl).toContain('/go/learn?subtopic=vectors-dot-product')
    expect(practiceUrl).toBe(
      `${PYQVAULT_URL}/go/practice?subtopic=vectors-dot-product`
    )
  })
  it('omits practice for a non-Maths subject (no practice bank)', () => {
    const { learnUrl, practiceUrl } = remediationLinks(
      q('cell-organelle-map', 'mitochondria'),
      'Biology'
    )
    expect(learnUrl).toBeTruthy()
    expect(practiceUrl).toBeNull()
  })
  it('omits practice when the question has no subtopic', () => {
    const { practiceUrl } = remediationLinks(q(undefined, 'x'), 'Maths')
    expect(practiceUrl).toBeNull()
  })
})

describe('practiceMistakesUrl', () => {
  it('bundles distinct Maths subtopics into one link', () => {
    const url = practiceMistakesUrl([q('a'), q('b'), q('a')], 'Maths')
    expect(url).toBe(`${PYQVAULT_URL}/go/practice?subtopic=a&subtopic=b`)
  })
  it('is null for a non-practice subject', () => {
    expect(practiceMistakesUrl([q('a')], 'Physics')).toBeNull()
  })
  it('is null when there are no subtopics to practise', () => {
    expect(practiceMistakesUrl([q(undefined)], 'Maths')).toBeNull()
  })
})

// ── Exam remediation (name-based; slugs preferred when present) ──
const exq = (over = {}) => ({
  q: 1, subject: 'Maths', chapter: 'Vectors', subtopic: 'Dot Product', ...over,
})

describe('examLearnUrl', () => {
  it('uses the subtopic NAME + chapter when no slug is present', () => {
    expect(examLearnUrl(exq())).toBe(
      `${PYQVAULT_URL}/go/learn?subtopic=Dot+Product&chapter=Vectors`
    )
  })
  it('prefers slugs + concept anchor when present (tagged questions)', () => {
    const url = examLearnUrl(exq({ subtopicSlug: 'vectors-dot-product', conceptSlug: 'dot-product' }))
    expect(url).toBe(
      `${PYQVAULT_URL}/go/learn?subtopic=vectors-dot-product&concept=dot-product&chapter=Vectors`
    )
  })
  it('returns null without a subtopic', () => {
    expect(examLearnUrl(exq({ subtopic: undefined }))).toBeNull()
    expect(examLearnUrl(null)).toBeNull()
  })
})

describe('examPracticeUrl', () => {
  it('carries subject+chapter+exam for name-mode resolution', () => {
    expect(examPracticeUrl(exq())).toBe(
      `${PYQVAULT_URL}/go/practice?subtopic=Dot+Product&subject=Maths&chapter=Vectors&exam=NDA`
    )
  })
  it('works for a non-Maths subject (PYQ corpus is chosen server-side)', () => {
    const url = examPracticeUrl(exq({ subject: 'English', chapter: 'Spotting Errors', subtopic: 'Conditional Sentences' }))
    expect(url).toContain('subject=English')
    expect(url).toContain('subtopic=Conditional+Sentences')
  })
  it('prefers the slug when present', () => {
    const url = examPracticeUrl(exq({ subtopicSlug: 'vectors-dot-product' }))
    expect(url).toContain('subtopic=vectors-dot-product')
  })
  it('returns null without a subtopic', () => {
    expect(examPracticeUrl(exq({ subtopic: undefined }))).toBeNull()
  })
})

describe('examRemediationLinks', () => {
  it('returns both links for a normal exam question', () => {
    const { learnUrl, practiceUrl } = examRemediationLinks(exq())
    expect(learnUrl).toContain('/go/learn?subtopic=Dot+Product')
    expect(practiceUrl).toContain('/go/practice?subtopic=Dot+Product')
  })
  it('returns nulls when the question has no subtopic', () => {
    const { learnUrl, practiceUrl } = examRemediationLinks(exq({ subtopic: undefined }))
    expect(learnUrl).toBeNull()
    expect(practiceUrl).toBeNull()
  })
})
