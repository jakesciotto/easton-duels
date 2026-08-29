import { describe, it, expect } from 'vitest'
import { parseRosterPaste } from '@/lib/roster-paste'

describe('parseRosterPaste', () => {
  it('parses name, age, weight, belt, and gender with optional fields', () => {
    const { rows, errors } = parseRosterPaste('Mateo Rivera, 8, 62, grey, M\nAva Park,9,70,gray/black,f\nNoah Tran\n\nZoe Ann Martin, 7')
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { firstName: 'Mateo', lastName: 'Rivera', age: 8, weightLbs: 62, belt: 'grey', gender: 'M' },
      { firstName: 'Ava', lastName: 'Park', age: 9, weightLbs: 70, belt: 'grey-black', gender: 'F' },
      { firstName: 'Noah', lastName: 'Tran', age: null, weightLbs: null, belt: null, gender: null },
      { firstName: 'Zoe Ann', lastName: 'Martin', age: 7, weightLbs: null, belt: null, gender: null },
    ])
  })
  it('reports bad lines with their number and keeps the good ones', () => {
    const { rows, errors } = parseRosterPaste('OnlyOneName, 8\nKai Wong, eight\nLiam C, 9, 60, purple')
    expect(rows).toHaveLength(0)
    expect(errors).toEqual(['line 1: needs a first and last name', 'line 2: age must be a number', 'line 3: unknown belt "purple"'])
  })
})
