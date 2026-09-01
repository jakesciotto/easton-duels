import { describe, it, expect } from 'vitest'
import { boardName, boardNameText } from '@/routes/board/names'
import { boardPlan, sortDoneMatches } from '@/routes/board/plan'
import type { EventMode, EventStatus, MatView, Snapshot } from '@shared/types'
import { sampleMatch, sampleSnapshot } from './fakes'

describe('boardName', () => {
  it('renders first name plus last initial', () => {
    expect(boardNameText('Mateo Rivera')).toBe('Mateo R.')
    expect(boardNameText('Mackenzie Tran')).toBe('Mackenzie T.')
  })

  it('takes the initial from the final name part', () => {
    expect(boardNameText('Ana Da Silva')).toBe('Ana S.')
  })

  it('keeps a single name whole and survives odd whitespace', () => {
    expect(boardNameText('Jayden')).toBe('Jayden')
    expect(boardNameText('  Leo   ferreira ')).toBe('Leo F.')
    expect(boardNameText('')).toBe('')
  })

  it('splits the parts so the field can truncate the first name and keep the initial', () => {
    expect(boardName('Maximiliano Whitaker')).toEqual({ first: 'Maximiliano', last: 'W.' })
  })
})

function mat(over: Partial<MatView> & { id: number; number: number }): MatView {
  return { current: null, onDeck: [], bound: false, ...over }
}

function event(status: EventStatus, mode: EventMode, matCount = 1): Snapshot['event'] {
  return { id: 1, name: 'Fall Duels', date: '2026-10-03', status, mode, matCount }
}

function atMode(snapshot: Snapshot, mode: EventMode): Snapshot {
  return { ...snapshot, event: { ...snapshot.event, mode } }
}

/**
 * A snapshot from a build older than the mode column. The field is typed as required, so
 * the only way to state its absence is to build the event row without it.
 */
function beforeTheField(snapshot: Snapshot): Snapshot {
  const { id, name, date, status, matCount } = snapshot.event
  return { ...snapshot, event: { id, name, date, status, matCount } as Snapshot['event'] }
}

describe('boardPlan', () => {
  it('is a cold start before the first snapshot lands', () => {
    expect(boardPlan(null)).toEqual({ comp: 'cold', mats: 1 })
  })

  it('chooses the mat band by mat count', () => {
    for (const n of [1, 2, 3, 4]) {
      const mats = Array.from({ length: n }, (_, i) => mat({ id: i + 1, number: i + 1, current: sampleMatch({ id: 100 + i }) }))
      expect(boardPlan(atMode(sampleSnapshot({ mats }), 'live'))).toEqual({ comp: 'mats', mats: n })
    }
  })

  it('reports the real mat count above four, and at least one below it', () => {
    // The API accepts up to eight mats. Clamping to four laid mats five and up out off
    // the bottom of a band that never mentioned they existed.
    const many = Array.from({ length: 6 }, (_, i) => mat({ id: i + 1, number: i + 1 }))
    expect(boardPlan(atMode(sampleSnapshot({ mats: many, matches: [] }), 'live')).mats).toBe(6)
    expect(boardPlan(atMode(sampleSnapshot({ mats: [], matches: [] }), 'live')).mats).toBe(1)
  })

  it('takes the composition from the stored mode, at one snapshot shape', () => {
    // The same four bound mats, each carrying a live match, and the two modes compose
    // the stage differently: the mats drive a live event, the desk drives an entry one.
    const mats = [1, 2, 3, 4].map(n => mat({ id: n, number: n, bound: true, current: sampleMatch({ id: 100 + n }) }))
    const snapshot = sampleSnapshot({ mats, matches: [] })
    expect(boardPlan(atMode(snapshot, 'live'))).toEqual({ comp: 'mats', mats: 4 })
    expect(boardPlan(atMode(snapshot, 'entry'))).toEqual({ comp: 'entry', mats: 1 })
  })

  it('never lets a live board flip to the final score panel between bouts', () => {
    // Nothing bound, nothing carrying, nothing held, results in hand: the exact snapshot
    // a reload produces between bouts, and the one that used to repaint the whole stage.
    const done = sampleMatch({ id: 2, status: 'done' })
    const snapshot = sampleSnapshot({ mats: [mat({ id: 1, number: 1 })], matches: [done] })
    expect(boardPlan(atMode(snapshot, 'live')).comp).toBe('mats')
  })

  it('never lets a data entry board show the mat ledger', () => {
    const running = sampleMatch({ id: 3 })
    const snapshot = sampleSnapshot({
      mats: [mat({ id: 1, number: 1, bound: true, current: running })],
      matches: [running],
    })
    expect(boardPlan(atMode(snapshot, 'entry')).comp).toBe('entry')
  })

  it('opens on setup and closes on done in both modes', () => {
    for (const mode of ['live', 'entry'] as const) {
      const setup = sampleSnapshot({
        event: event('setup', mode, 2),
        mats: [mat({ id: 1, number: 1, onDeck: [sampleMatch({ id: 5, status: 'pending' })] }), mat({ id: 2, number: 2 })],
        matches: [],
      })
      expect(boardPlan(setup), mode).toEqual({ comp: 'setup', mats: 2 })

      const done = sampleSnapshot({ event: event('done', mode) })
      expect(boardPlan(done).comp, mode).toBe('done')
    }
  })

  it('leaves setup for the mode composition as soon as anything has been scored', () => {
    const scored = (mode: EventMode) => sampleSnapshot({
      event: event('setup', mode),
      mats: [mat({ id: 1, number: 1, bound: true })],
      matches: [sampleMatch({ id: 2, status: 'done' })],
    })
    expect(boardPlan(scored('live')).comp).toBe('mats')
    expect(boardPlan(scored('entry')).comp).toBe('entry')
  })

  // The inference is deleted, not kept behind a version check. The bundle and the snapshot
  // come off one deploy, so this skew cannot happen, and the branch that read a quiet mat
  // rack as a desk is exactly the bug the column was added to end. A missing mode reads as
  // live, which is the column default and the only value an older event can hold.
  it('reads a snapshot with no mode as live rather than inferring one from the mats', () => {
    const done = sampleMatch({ id: 2, status: 'done' })
    const idle = beforeTheField(sampleSnapshot({ mats: [mat({ id: 1, number: 1 })], matches: [done] }))
    expect(boardPlan(idle).comp).toBe('mats')

    const bound = beforeTheField(sampleSnapshot({
      mats: [mat({ id: 1, number: 1, bound: true, current: sampleMatch({ id: 3 }) })],
      matches: [done],
    }))
    expect(boardPlan(bound).comp).toBe('mats')
  })
})

describe('sortDoneMatches', () => {
  it('puts the newest finish first and sorts a missing endedAt last', () => {
    const sorted = sortDoneMatches([
      sampleMatch({ id: 1, endedAt: '2026-10-03T16:00:00.000Z' }),
      sampleMatch({ id: 2, endedAt: null }),
      sampleMatch({ id: 3, endedAt: '2026-10-03T16:05:00.000Z' }),
    ])
    expect(sorted.map(m => m.id)).toEqual([3, 1, 2])
  })
})
