import { describe, it, expect } from 'vitest'
import { getScienceStream } from '../scienceStream'

describe('getScienceStream', () => {
  it('tags Physics chapters', () => {
    expect(getScienceStream('Science', 'Laws of Motion')).toBe('P')
    expect(getScienceStream('Science', 'Gravitation')).toBe('P')
    expect(getScienceStream('Science', 'Reflection of Light')).toBe('P')
    expect(getScienceStream('Science', 'Observing Space : Telescopes')).toBe('P')
    expect(getScienceStream('Science', 'Space Missions')).toBe('P')
  })

  it('tags Chemistry chapters', () => {
    expect(getScienceStream('Science', 'Acids, Bases and Salts')).toBe('C')
    expect(getScienceStream('Science', 'Periodic Classification of Element')).toBe('C')
    expect(getScienceStream('Science', 'Carbon : An important element')).toBe('C')
    expect(getScienceStream('Science', 'Carbon compounds')).toBe('C')
  })

  it('tags Biology chapters', () => {
    expect(getScienceStream('Science', 'Classification of Plants')).toBe('B')
    expect(getScienceStream('Science', 'Cell Biology and Biotechnology')).toBe('B')
    expect(getScienceStream('Science', 'Social health')).toBe('B')
    // 9th uses "Management", 10th "management" — case-insensitive match, both Biology
    expect(getScienceStream('Science', 'Environmental Management')).toBe('B')
    expect(getScienceStream('Science', 'Environmental management')).toBe('B')
  })

  it('matches across hyphen/spacing variants (both Part chapters -> B)', () => {
    expect(getScienceStream('Science', 'Life Processes in Living Organisms Part -1')).toBe('B')
    expect(getScienceStream('Science', 'Life Processes in Living Organisms Part - 2')).toBe('B')
    expect(getScienceStream('Science', 'Life Processes in Living Organisms')).toBe('B')
  })

  it('returns null for general (non-P/C/B) Science chapters', () => {
    expect(getScienceStream('Science', 'Information Communication Technology (ICT)')).toBeNull()
    expect(getScienceStream('Science', 'Disaster Management')).toBeNull()
    expect(getScienceStream('Science', 'Towards Green Energy')).toBeNull()
  })

  it('returns null for any non-Science subject (even matching chapter names)', () => {
    expect(getScienceStream('Maths', 'Circle')).toBeNull()
    expect(getScienceStream('Geography', 'Gravitation')).toBeNull()
    expect(getScienceStream('English', 'Laws of Motion')).toBeNull()
  })

  it('returns null for unknown chapters and bad input', () => {
    expect(getScienceStream('Science', 'Some Unmapped Chapter')).toBeNull()
    expect(getScienceStream('Science', '')).toBeNull()
    expect(getScienceStream('Science', undefined)).toBeNull()
    expect(getScienceStream(undefined, 'Gravitation')).toBeNull()
  })
})
