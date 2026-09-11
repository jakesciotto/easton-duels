import { describe, it, expect } from 'vitest'
import { TEAM_COLOR_KEYS, type TeamColor } from '@shared/types'
import { CONFUSION_FLOOR, CONFUSION_WARN, HUE_FLOOR, colourVerdict, confusion, freeColors, hueSeparation, nextColor, suggestions } from '@/lib/team-guard'

const blocked = (chosen: TeamColor) => TEAM_COLOR_KEYS.filter(c => c !== chosen && colourVerdict(c, [chosen]).level === 'block')

describe('team colour guards', () => {
  it('blocks exactly the two ring neighbours on hue alone, which is what 2.4 predicts', () => {
    // Crimson sits at 25 with Amber at 68 and Magenta at 340. Citron is 87 away and
    // Green 125, so neither is a hue neighbour: a previous revision blocked the wrong
    // three and left the actual nearest hue enabled.
    const byHue = TEAM_COLOR_KEYS.filter(c => c !== 'red' && hueSeparation('red', c) < HUE_FLOOR)
    expect(byHue).toEqual(['pink', 'orange'])
    expect(hueSeparation('red', 'amber')).toBe(125)
  })

  it('names the pair and two legal swaps, generated rather than written', () => {
    expect(colourVerdict('orange', ['red'])).toEqual({
      level: 'block',
      reason: 'Crimson and Amber look the same from the back of the gym. Try Azure or Teal.',
    })
  })

  it('adds the pairs hue misses, so the confusion set is a strict superset', () => {
    // Magenta and Teal are 144 degrees apart and simulate under a dE00 of 1 for a
    // deuteranope. Hue separation cannot see that at all.
    expect(hueSeparation('pink', 'teal')).toBe(144)
    expect(confusion('pink', 'teal')).toBeLessThan(CONFUSION_FLOOR)
    expect(colourVerdict('teal', ['pink']).reason).toBe('These two look the same to about one person in twelve. Try Citron or Green.')

    expect(blocked('red')).toEqual(['green', 'amber', 'pink', 'orange'])
    for (const c of TEAM_COLOR_KEYS) {
      expect(blocked(c).length).toBeGreaterThanOrEqual(new Set(TEAM_COLOR_KEYS.filter(o => o !== c && hueSeparation(c, o) < HUE_FLOOR)).size)
    }
  })

  it('warns rather than blocks between 20 and 30', () => {
    const dE = confusion('red', 'teal')
    expect(dE).toBeGreaterThanOrEqual(CONFUSION_FLOOR)
    expect(dE).toBeLessThan(CONFUSION_WARN)
    expect(colourVerdict('teal', ['red']).level).toBe('warn')
  })

  it('never leaves an organizer without a legal partner', () => {
    for (const c of TEAM_COLOR_KEYS) {
      expect(TEAM_COLOR_KEYS.length - 1 - blocked(c).length).toBeGreaterThanOrEqual(3)
      expect(suggestions([c])).toHaveLength(2)
    }
  })

  it('refuses the colour the other team already holds', () => {
    expect(colourVerdict('blue', ['blue']).level).toBe('block')
  })

  it('leaves the shipped default pair legal', () => {
    expect(colourVerdict('blue', ['red']).level).toBe('ok')
  })

  // An event holds up to eight teams, so a colour has to survive every one of them.
  it('takes the worst verdict across every team already on the event', () => {
    expect(colourVerdict('purple', ['red']).level).toBe('ok')
    expect(colourVerdict('purple', ['red', 'blue']).level).toBe('block')
  })

  it('keeps a colour another team holds off the grid', () => {
    expect(freeColors(['red', 'blue'])).not.toContain('red')
    expect(freeColors(['red', 'blue'])).not.toContain('blue')
    expect(freeColors([])).toEqual(TEAM_COLOR_KEYS)
  })

  // Eight hues 45 degrees apart cannot all clear a 60 degree floor, so a third team has
  // nothing legal left. The suggestion is empty rather than wrong, and a fresh team still
  // opens on a free colour.
  it('runs out of legal colours past two teams, and still opens a third on a free one', () => {
    expect(suggestions(['red', 'blue'])).toEqual([])
    expect(colourVerdict('green', ['red', 'blue']).reason).not.toContain('Try')
    expect(['red', 'blue']).not.toContain(nextColor(['red', 'blue']))
  })
})
