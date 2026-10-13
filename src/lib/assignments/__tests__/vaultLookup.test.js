import { describe, it, expect } from 'vitest'
import { vaultSearchPath, formatVaultHit, MIN_TERM_CHARS } from '../vaultLookup'

describe('vaultSearchPath', () => {
  it('ANDs every phrase as a case-insensitive substring match on the question text', () => {
    const path = vaultSearchPath(['pair of lines', 'acute angle'])
    expect(path).toBe(
      'questions?select=id,text,solution,pyq_year,marks'
      + '&text=ilike.*pair%20of%20lines*&text=ilike.*acute%20angle*'
      + '&order=pyq_year.desc.nullslast&limit=5'
    )
  })

  it('encodes characters PostgREST would read as syntax', () => {
    expect(vaultSearchPath(['f(x) & g(x)'])).toContain('text=ilike.*f(x)%20%26%20g(x)*')
  })

  it('trims phrases and drops blanks', () => {
    expect(vaultSearchPath(['  ratio m : n  ', ' '])).toContain('text=ilike.*ratio%20m%20%3A%20n*&order')
  })

  it('refuses no phrase at all, or a phrase too short to narrow the bank', () => {
    expect(() => vaultSearchPath([])).toThrow(/phrase/)
    expect(() => vaultSearchPath(['dx'])).toThrow(new RegExp(String(MIN_TERM_CHARS)))
  })

  it('takes a custom limit', () => {
    expect(vaultSearchPath(['pair of lines'], { limit: 10 })).toMatch(/limit=10$/)
  })
})

describe('formatVaultHit', () => {
  it('prints the id, year, marks, the question and its stored solution', () => {
    const out = formatVaultHit({ id: 'q1', pyq_year: 2024, marks: 4, text: 'Prove that…', solution: 'Let…' })
    expect(out).toContain('q1')
    expect(out).toContain('2024')
    expect(out).toContain('4 marks')
    expect(out).toContain('Prove that…')
    expect(out).toContain('Let…')
  })

  it('says so when a question has no stored solution, rather than printing nothing', () => {
    expect(formatVaultHit({ id: 'q2', text: 'Find…', solution: null })).toMatch(/no stored solution/i)
  })
})
