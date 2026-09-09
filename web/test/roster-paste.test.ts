import { describe, it, expect } from 'vitest'
import { parseRosterPaste, FIELD_LABEL } from '@/lib/roster-paste'
import type { TeamRow } from '@/lib/types'

const teams: TeamRow[] = [
  { id: 1, eventId: 7, name: 'Ridgeline', color: 'red', position: 0 },
  { id: 2, eventId: 7, name: 'Lakeside', color: 'blue', position: 1 },
]

describe('parseRosterPaste, positional (no header)', () => {
  it('parses name, age, weight, belt, and gender with optional fields', () => {
    const { rows, errors, mapping } = parseRosterPaste('Mateo Rivera, 8, 62, grey, M\nAva Park,9,70,gray/black,f\nNoah Tran\n\nZoe Ann Martin, 7')
    expect(errors).toEqual([])
    expect(mapping.header).toBe(false)
    expect(mapping.delimiter).toBe('comma')
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

  it('rejects an out-of-range age or weight with a row error', () => {
    expect(parseRosterPaste('Kai Wong, 2').errors).toEqual(['line 1: age must be between 3 and 17'])
    expect(parseRosterPaste('Kai Wong, 18').errors).toEqual(['line 1: age must be between 3 and 17'])
    expect(parseRosterPaste('Kai Wong, 8, 19').errors).toEqual(['line 1: weight must be between 20 and 250'])
    expect(parseRosterPaste('Kai Wong, 8, 251').errors).toEqual(['line 1: weight must be between 20 and 250'])
  })

  it('accepts the boundary age and weight values', () => {
    expect(parseRosterPaste('Kai Wong, 3, 20').rows).toEqual([{ firstName: 'Kai', lastName: 'Wong', age: 3, weightLbs: 20, belt: null, gender: null }])
    expect(parseRosterPaste('Kai Wong, 17, 250').rows).toEqual([{ firstName: 'Kai', lastName: 'Wong', age: 17, weightLbs: 250, belt: null, gender: null }])
  })

  it('keeps a one cell line that resembles a field name as a competitor', () => {
    const { mapping, lines, errors } = parseRosterPaste('Al Grade\nBo Kim')
    expect(mapping.header).toBe(false)
    expect(lines.map(l => l.row?.lastName)).toEqual(['Grade', 'Kim'])
    expect(errors).toEqual([])
  })

  it('reads a lone exact field name as a header', () => {
    const { mapping, lines } = parseRosterPaste('Name\nAl Grade')
    expect(mapping).toEqual({ header: true, delimiter: 'comma', columns: ['name'], ignored: [] })
    expect(lines.map(l => l.row?.lastName)).toEqual(['Grade'])
  })

  it('never reads a bare number line as a header', () => {
    const { mapping } = parseRosterPaste('Name,8\nMateo Rivera,9')
    expect(mapping.header).toBe(false)
    expect(mapping.delimiter).toBe('comma')
  })
})

describe('parseRosterPaste, header row', () => {
  it('maps a tab separated sheet with a header and parses it', () => {
    const { rows, errors, mapping } = parseRosterPaste('Name\tAge\tWeight\tBelt\tGender\nMateo Rivera\t8\t62\tgrey\tM')
    expect(errors).toEqual([])
    expect(mapping).toEqual({ header: true, delimiter: 'tab', columns: ['name', 'age', 'weight', 'belt', 'gender'], ignored: [] })
    expect(rows).toEqual([{ firstName: 'Mateo', lastName: 'Rivera', age: 8, weightLbs: 62, belt: 'grey', gender: 'M' }])
  })

  it('builds the name from separate First Name and Last Name columns', () => {
    const { rows, mapping } = parseRosterPaste('First Name,Last Name,Age\nMateo,Rivera,8')
    expect(mapping.columns).toEqual(['first', 'last', 'age'])
    expect(rows).toEqual([{ firstName: 'Mateo', lastName: 'Rivera', age: 8, weightLbs: null, belt: null, gender: null }])
  })

  it('maps "Weight (lbs)" to weight and parses "62 lb" to 62', () => {
    const { rows, mapping } = parseRosterPaste('Name,Weight (lbs)\nMateo Rivera,62 lb')
    expect(mapping.columns).toEqual(['name', 'weight'])
    expect(rows[0].weightLbs).toBe(62)
  })

  it('maps "Rank" to belt', () => {
    const { rows, mapping } = parseRosterPaste('Name,Rank\nMateo Rivera,grey')
    expect(mapping.columns).toEqual(['name', 'belt'])
    expect(rows[0].belt).toBe('grey')
  })

  it('ignores an unrecognized column and names it', () => {
    const { rows, mapping } = parseRosterPaste('Name,Email\nMateo Rivera,mateo@example.com')
    expect(mapping.columns).toEqual(['name', null])
    expect(mapping.ignored).toEqual(['Email'])
    expect(rows).toEqual([{ firstName: 'Mateo', lastName: 'Rivera', age: null, weightLbs: null, belt: null, gender: null }])
  })

  it('keeps the better scoring column when two columns map to one field', () => {
    const { rows, mapping } = parseRosterPaste('Name,Weight,Weights\nMateo Rivera,62,80')
    expect(mapping.columns).toEqual(['name', 'weight', null])
    expect(mapping.ignored).toEqual(['Weights'])
    expect(rows[0].weightLbs).toBe(62)
  })

  it('reports "needs a name column" on every line when the header has no name column', () => {
    const { rows, errors, lines } = parseRosterPaste('Age,Weight,Belt\n8,62,grey\n9,70,purple')
    expect(rows).toEqual([])
    expect(errors).toEqual(['line 2: needs a name column', 'line 3: needs a name column'])
    expect(lines.every(l => l.row === null && l.problem === 'needs a name column')).toBe(true)
  })

  it('assigns a team by name from a team column and reports an unknown team', () => {
    const { lines } = parseRosterPaste('Name,Team\nMateo Rivera,Ridgeline\nAva Park,Nowhere', teams)
    expect(lines[0].row?.teamId).toBe(1)
    expect(lines[0].problem).toBeNull()
    expect(lines[1].row).toBeNull()
    expect(lines[1].problem).toBe('unknown team "Nowhere"')
  })

  it('numbers the first data line by the text\'s own line number', () => {
    const noBlank = parseRosterPaste('Name,Age\nMateo Rivera,8')
    expect(noBlank.lines[0].n).toBe(2)

    const leadingBlank = parseRosterPaste('\nName,Age\nMateo Rivera,8')
    expect(leadingBlank.lines[0].n).toBe(3)
  })
})

describe('FIELD_LABEL', () => {
  it('names every field the way the table heads already do', () => {
    expect(FIELD_LABEL).toEqual({
      name: 'Name', first: 'First', last: 'Last', age: 'Age', weight: 'lb', belt: 'Belt', gender: 'Gender', team: 'Team',
    })
  })
})
