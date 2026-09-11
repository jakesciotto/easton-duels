import { describe, it, expect } from 'vitest'
import { normalize, dice, NICKNAMES, canonicalFirst, exactName, nameScore, nameTokens, SUGGEST_FLOOR, SUGGEST_MARGIN } from '../src/shared/similarity.js'

describe('normalize', () => {
  it('lowercases and keeps only letters and digits', () => {
    expect(normalize('Weight (lbs)')).toBe('weightlbs')
    expect(normalize('First Name')).toBe('firstname')
    expect(normalize('  Rank  ')).toBe('rank')
  })

  it('folds accents away, so a hyphen and a space read the same', () => {
    expect(normalize('José Núñez-Ortiz')).toBe('josenunezortiz')
    expect(normalize('José Núñez-Ortiz')).toBe(normalize('Jose Nunez Ortiz'))
    expect(normalize('Chloë')).toBe('chloe')
  })
})

describe('dice', () => {
  it('scores equal strings at 1', () => {
    expect(dice('weight', 'weight')).toBe(1)
    expect(dice('Weight', 'WEIGHT')).toBe(1)
  })

  it('scores disjoint strings at 0', () => {
    expect(dice('abc', 'xyz')).toBe(0)
  })

  it('scores "weight lbs" against "weight" above 0.6', () => {
    expect(dice('weight lbs', 'weight')).toBeGreaterThan(0.6)
  })

  it('scores "lb" against "belt" below 0.6', () => {
    expect(dice('lb', 'belt')).toBeLessThan(0.6)
  })

  it('ignores case and punctuation', () => {
    expect(dice('Weight!!!', 'weight')).toBe(1)
    expect(dice('First-Name', 'first name')).toBe(1)
  })

  it('answers 1 only for equal normalized single character strings, else 0', () => {
    expect(dice('a', 'a')).toBe(1)
    expect(dice('a', 'b')).toBe(0)
    expect(dice('a', 'ab')).toBe(0)
  })
})

describe('canonicalFirst', () => {
  it('folds a nickname onto the first entry of its group', () => {
    expect(canonicalFirst('Alexander')).toBe('alex')
    expect(canonicalFirst('Alejandro')).toBe('alex')
    expect(canonicalFirst('Katie')).toBe('kate')
    expect(canonicalFirst('Isabella')).toBe('izzy')
  })

  it('answers the normalized first token when no group holds the name', () => {
    expect(canonicalFirst('Mateo')).toBe('mateo')
    expect(canonicalFirst('Mateo Luis')).toBe('mateo')
    expect(canonicalFirst('José')).toBe('jose')
  })

  it('holds no name in two groups', () => {
    const seen = new Set<string>()
    for (const group of NICKNAMES) {
      for (const name of group) {
        expect(seen.has(name), `${name} is in two groups`).toBe(false)
        seen.add(name)
      }
    }
  })
})

describe('exactName', () => {
  const rivera = { firstName: 'Mateo', lastName: 'Rivera' }

  it('ignores a middle name and an initial on the first name', () => {
    expect(exactName({ firstName: 'Mateo Luis', lastName: 'Rivera' }, rivera)).toBe(true)
    expect(exactName({ firstName: 'Mateo L.', lastName: 'Rivera' }, rivera)).toBe(true)
  })

  it('reads accents and hyphens as the plain letters', () => {
    expect(exactName({ firstName: 'José', lastName: 'Núñez-Ortiz' }, { firstName: 'Jose', lastName: 'Nunez Ortiz' })).toBe(true)
    expect(exactName({ firstName: 'Mary-Kate', lastName: 'Olsen' }, { firstName: 'Mary Kate', lastName: 'Olsen' })).toBe(true)
  })

  it('takes a nickname as the same first name', () => {
    expect(exactName({ firstName: 'Alex', lastName: 'Reyes' }, { firstName: 'Alexander', lastName: 'Reyes' })).toBe(true)
    expect(exactName({ firstName: 'Zach', lastName: 'Reyes' }, { firstName: 'Zachary', lastName: 'Reyes' })).toBe(true)
  })

  it('refuses a different last name or a different first name', () => {
    expect(exactName(rivera, { firstName: 'Mateo', lastName: 'Rivera-Lopez' })).toBe(false)
    expect(exactName(rivera, { firstName: 'Marco', lastName: 'Rivera' })).toBe(false)
  })
})

describe('nameScore', () => {
  const mateo = { firstName: 'Mateo', lastName: 'Rivera' }

  it('scores a hyphenated surname above the suggestion floor', () => {
    expect(nameScore(mateo, { firstName: 'Mateo', lastName: 'Rivera-Lopez' })).toBeCloseTo(0.8, 5)
  })

  it('adds 0.1 when the last names match exactly', () => {
    const withLast = nameScore({ firstName: 'Jon', lastName: 'Smith' }, { firstName: 'Jonathan', lastName: 'Smith' })
    const withoutLast = dice('Jon Smith', 'Jonathan Smith')
    expect(withLast).toBeCloseTo(withoutLast + 0.1, 5)
  })

  it('caps at 1', () => {
    expect(nameScore(mateo, { firstName: 'Mateo', lastName: 'Rivera' })).toBe(1)
  })

  it('ranks the closer candidate higher', () => {
    const near = nameScore(mateo, { firstName: 'Mateo', lastName: 'Riveras' })
    const far = nameScore(mateo, { firstName: 'Olivia', lastName: 'Kim' })
    expect(near).toBeGreaterThan(far)
    expect(far).toBeLessThan(SUGGEST_FLOOR)
  })

  it('keeps a floor of 0.6 and a margin of 0.05', () => {
    expect(SUGGEST_FLOOR).toBe(0.6)
    expect(SUGGEST_MARGIN).toBe(0.05)
  })
})

describe('nameTokens', () => {
  it('takes the whole name as one token when nothing separates it', () => {
    expect(nameTokens('Rivera')).toEqual(['rivera'])
  })

  it('splits on hyphens, spaces, and punctuation', () => {
    expect(nameTokens('Mary Kate-Olsen')).toEqual(['mary', 'kate', 'olsen'])
    expect(nameTokens("O'Neil")).toEqual(['neil'])
  })

  it('carries an accented token both as typed and folded to ASCII', () => {
    expect(nameTokens('Nunez-Ortiz')).toEqual(['nunez', 'ortiz'])
    expect(nameTokens('Nuñez-Ortiz')).toEqual(['nuñez', 'nunez', 'ortiz'])
  })

  it('drops a part under three letters when a longer part narrows the name', () => {
    expect(nameTokens('Ana Li Vo')).toEqual(['ana'])
  })

  it('takes every part at whatever length it has when no part is three letters long', () => {
    expect(nameTokens('Ng')).toEqual(['ng'])
    expect(nameTokens('Vo')).toEqual(['vo'])
    // Never 'ngli': a like on the parts run together would match no stored name.
    expect(nameTokens('Ng-Li')).toEqual(['ng', 'li'])
    expect(nameTokens('Ñu')).toEqual(['ñu', 'nu'])
  })

  it('answers each token once', () => {
    expect(nameTokens('Smith-Smith')).toEqual(['smith'])
  })

  it('answers nothing for a name with no letters', () => {
    expect(nameTokens('  ')).toEqual([])
    expect(nameTokens('--')).toEqual([])
    expect(nameTokens('123')).toEqual([])
  })
})
