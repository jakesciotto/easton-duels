import { describe, it, expect } from 'vitest'
import { genderLabel } from '@/lib/format'

// The column is free text up to ten characters. The roster sync writes "Male", a hand entry
// writes "M", and the roster row prints the value inside a line that must never wrap, so a
// four letter value costs the rating its place on the row.
describe('genderLabel', () => {
  it('shortens what the roster sync writes', () => {
    expect(genderLabel('Male')).toBe('M')
    expect(genderLabel('Female')).toBe('F')
  })

  it('leaves what a hand entry writes alone', () => {
    expect(genderLabel('M')).toBe('M')
    expect(genderLabel('F')).toBe('F')
  })

  it('takes the first letter of anything else, because the column is free text', () => {
    expect(genderLabel('boy')).toBe('B')
    expect(genderLabel('  girl ')).toBe('G')
  })

  it('has nothing to say when the value is missing or blank', () => {
    expect(genderLabel(null)).toBeNull()
    expect(genderLabel('')).toBeNull()
    expect(genderLabel('   ')).toBeNull()
  })
})
