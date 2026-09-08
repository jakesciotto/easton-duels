import { describe, it, expect } from 'vitest'
import type { MatView, Snapshot } from '@shared/types'
import {
  CERTIFIED_REFUSAL, DESK_BIND_REFUSAL, DESK_NOTE, DESK_NOTE_DETAIL, MODE_LABEL, MODE_OPTIONS, MODE_ORDER,
  deskSwitchConsequence, deskSwitchMidMatch, deskSwitchRefusal, isCertifiedRefusal, isFinished, modeOf,
  toMode, writeErrorMessage,
} from '@/lib/eventMode'
import { ApiError } from '@/lib/api'
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

const RUNNING = { elapsedMs: 0, startedAt: '2026-10-03T16:00:00.000Z', lengthMs: 300_000 }
const STOPPED = { elapsedMs: 40_000, startedAt: null, lengthMs: 300_000 }

/**
 * The guard only ever refuses for a running clock now.
 *
 * The old one also refused for a bound mat and for any mat carrying a match, and once an
 * idle mat calls the next match the instant one ends, every mat carries one for the whole
 * afternoon: the control was disabled all event and the desk fallback the setting exists
 * to reach was unreachable.
 */
describe('deskSwitchRefusal', () => {
  it('lets the switch through when no clock is running', () => {
    expect(deskSwitchRefusal(withMats([mat({ id: 1, number: 1 }), mat({ id: 2, number: 2 })]))).toBeNull()
  })

  it('lets a bound mat with nothing on it through', () => {
    expect(deskSwitchRefusal(withMats([mat({ id: 1, number: 1, bound: true })]))).toBeNull()
  })

  it('lets a mat holding a stopped match through, because that is the confirm case', () => {
    const paused = sampleMatch({ id: 10, clock: STOPPED })
    expect(deskSwitchRefusal(withMats([mat({ id: 1, number: 1, current: paused, bound: true })]))).toBeNull()
  })

  it('names the mat whose clock is running and says what the board would do', () => {
    const running = sampleMatch({ id: 10, clock: RUNNING })
    const refusal = deskSwitchRefusal(withMats([mat({ id: 1, number: 1, current: running }), mat({ id: 2, number: 2 })]))
    expect(refusal).toBe('Mat 1 has a clock running. The board drops the mat rack as soon as the desk takes over.')
  })

  it('agrees with itself in the plural and starts the clause as a sentence', () => {
    const running = (id: number) => sampleMatch({ id, clock: RUNNING })
    const refusal = deskSwitchRefusal(withMats([
      mat({ id: 1, number: 1, current: running(10) }),
      mat({ id: 2, number: 2, current: running(11) }),
      mat({ id: 3, number: 3, current: running(12) }),
      mat({ id: 4, number: 4 }),
    ]))
    expect(refusal).toBe(
      'Mats 1, 2 and 3 have a clock running. The board drops the mat rack as soon as the desk takes over.',
    )
  })

  // The guard cannot see the mats yet, and no fallback it has says which of them hold a
  // clock, so it refuses in the words the Live tab already prints for the same silence.
  it('refuses while nothing has arrived from the server', () => {
    expect(deskSwitchRefusal(null)).toBe('Waiting for the first update from the server.')
  })
})

describe('deskSwitchMidMatch', () => {
  it('finds the mats holding a stopped match, in mat order, with both names', () => {
    const paused = sampleMatch({ id: 10, clock: STOPPED })
    const notStarted = sampleMatch({ id: 11 })
    const mats = deskSwitchMidMatch(withMats([
      mat({ id: 2, number: 2, current: notStarted, bound: true }),
      mat({ id: 1, number: 1, current: paused, bound: true }),
    ]))
    expect(mats).toEqual([
      { number: 1, pair: 'Mateo Rivera vs Olivia Kim' },
      { number: 2, pair: 'Mateo Rivera vs Olivia Kim' },
    ])
  })

  it('leaves out a running clock, a finished match and an idle mat', () => {
    const running = sampleMatch({ id: 10, clock: RUNNING })
    const done = sampleMatch({ id: 11, status: 'done', clock: STOPPED })
    expect(deskSwitchMidMatch(withMats([
      mat({ id: 1, number: 1, current: running }),
      mat({ id: 2, number: 2, current: done }),
      mat({ id: 3, number: 3, bound: true }),
    ]))).toEqual([])
  })

  it('says nothing while there is no snapshot', () => {
    expect(deskSwitchMidMatch(null)).toEqual([])
  })
})

// Stated once for the whole set rather than repeated per mat, and it agrees with itself.
describe('deskSwitchConsequence', () => {
  it('names the one mat and its one result', () => {
    expect(deskSwitchConsequence([{ number: 2, pair: 'a vs b' }]))
      .toBe('Mat 2 is mid-match. Its result will have to be typed at the desk.')
  })

  it('turns plural on both halves together', () => {
    expect(deskSwitchConsequence([{ number: 1, pair: 'a vs b' }, { number: 3, pair: 'c vs d' }]))
      .toBe('Mats 1 and 3 are mid-match. Their results will have to be typed at the desk.')
  })
})

/**
 * Certified reads as done everywhere a layout is chosen. The two states differ only in
 * what may still be changed, which every write surface asks separately.
 */
describe('isFinished', () => {
  it('is true for both states the event stops taking new results in', () => {
    expect(isFinished('done')).toBe(true)
    expect(isFinished('certified')).toBe(true)
  })

  it('is false while the event can still be scored', () => {
    expect(isFinished('setup')).toBe(false)
    expect(isFinished('live')).toBe(false)
  })
})

describe('the certified refusal', () => {
  const refused = (message: string, code = 'match_state') => new ApiError(409, code, message)

  it('recognises the server sentence every locked write answers with', () => {
    expect(isCertifiedRefusal(refused('event is certified'))).toBe(true)
  })

  it('leaves the other match_state refusals alone, which say something else to do', () => {
    expect(isCertifiedRefusal(refused('event is done'))).toBe(false)
    expect(isCertifiedRefusal(refused('match is done'))).toBe(false)
    expect(isCertifiedRefusal(refused('event is certified', 'validation'))).toBe(false)
    expect(isCertifiedRefusal(new Error('event is certified'))).toBe(false)
  })

  it('maps the refusal to one sentence and keeps every other server message', () => {
    expect(writeErrorMessage(refused('event is certified'))).toBe(CERTIFIED_REFUSAL)
    expect(writeErrorMessage(refused('only a live event can finish'))).toBe('only a live event can finish')
  })
})
