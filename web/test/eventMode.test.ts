import { describe, it, expect } from 'vitest'
import type { MatView, Snapshot } from '@shared/types'
import {
  DESK_BIND_REFUSAL, DESK_NOTE, DESK_NOTE_DETAIL, MODE_LABEL, MODE_OPTIONS, MODE_ORDER,
  deskSwitchRefusal, modeOf, toMode,
} from '@/lib/eventMode'
import { sampleMatch, sampleSnapshot } from './fakes'

const mat = (over: Partial<MatView> & { id: number; number: number }): MatView =>
  ({ current: null, onDeck: [], bound: false, ...over })

const withMats = (mats: MatView[]): Snapshot => sampleSnapshot({ mats, matches: [] })

/**
 * One vocabulary for the one setting. The New event dialog and the event shell each held
 * their own list, in different words and the opposite order, on the two screens an
 * organizer moves between on the morning of the event.
 */
describe('the shared mode vocabulary', () => {
  it('offers one order and one set of labels, and the copy is built from them', () => {
    expect(MODE_ORDER).toEqual(['live', 'entry'])
    expect(MODE_OPTIONS).toEqual([
      { value: 'live', label: MODE_LABEL.live },
      { value: 'entry', label: MODE_LABEL.entry },
    ])
    // Every screen that names the desk mode opens on the same clause, and the sentence
    // that sends an organizer back to the other mode names it by its own label.
    expect(DESK_NOTE.startsWith('This event runs from the desk')).toBe(true)
    expect(DESK_BIND_REFUSAL.startsWith('This event runs from the desk')).toBe(true)
    expect(DESK_NOTE_DETAIL).toContain(MODE_LABEL.live)
  })

  it('reads any stored value back as one of the two modes', () => {
    expect(toMode('entry')).toBe('entry')
    expect(toMode('live')).toBe('live')
    expect(toMode('')).toBe('live')
  })
})

describe('modeOf', () => {
  it('takes the stream over the fallback, and the fallback only when there is no stream', () => {
    const entry = { ...withMats([]), event: { ...withMats([]).event, mode: 'entry' as const } }
    expect(modeOf(entry, 'live')).toBe('entry')
    expect(modeOf(null, 'entry')).toBe('entry')
    expect(modeOf(null, 'live')).toBe('live')
  })
})

describe('deskSwitchRefusal', () => {
  it('lets the switch through when no mat is bound and no mat is carrying a match', () => {
    expect(deskSwitchRefusal(withMats([mat({ id: 1, number: 1 }), mat({ id: 2, number: 2 })]))).toBeNull()
  })

  it('names the bound mat and says what the board would do', () => {
    const refusal = deskSwitchRefusal(withMats([mat({ id: 1, number: 1, bound: true }), mat({ id: 2, number: 2 })]))
    expect(refusal).toBe('Mat 1 has an iPad connected. The board drops the mat rack as soon as the desk takes over.')
  })

  it('names a mat that is carrying a match even with no tablet on it', () => {
    const running = sampleMatch({ id: 10 })
    const refusal = deskSwitchRefusal(withMats([mat({ id: 3, number: 3, current: running })]))
    expect(refusal).toBe('Mat 3 is on a match. The board drops the mat rack as soon as the desk takes over.')
  })

  it('agrees with itself in the plural and starts every clause as a sentence', () => {
    const running = sampleMatch({ id: 10 })
    const refusal = deskSwitchRefusal(withMats([
      mat({ id: 1, number: 1, bound: true }),
      mat({ id: 2, number: 2, bound: true }),
      mat({ id: 3, number: 3, current: running }),
      mat({ id: 4, number: 4 }),
    ]))
    expect(refusal).toBe(
      'Mats 1 and 2 have an iPad connected. Mat 3 is on a match. '
      + 'The board drops the mat rack as soon as the desk takes over.',
    )
  })

  // The guard cannot see the mats yet, and no fallback it has says which of them hold a
  // tablet, so it refuses in the words the Live tab already prints for the same silence.
  it('refuses while nothing has arrived from the server', () => {
    expect(deskSwitchRefusal(null)).toBe('Waiting for the first update from the server.')
  })
})
