import { describe, it, expect } from 'vitest'
import { boardName, boardNameText } from '@/routes/board/names'
import { boardPlan, sortDoneMatches } from '@/routes/board/plan'
import type { MatView, MatchView } from '@shared/types'
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

describe('boardPlan', () => {
  const empty = new Map<number, MatchView>()

  it('is a cold start before the first snapshot lands', () => {
    expect(boardPlan(null, empty)).toEqual({ comp: 'cold', mats: 1 })
  })

  it('chooses the mat band by mat count', () => {
    for (const n of [1, 2, 3, 4]) {
      const mats = Array.from({ length: n }, (_, i) => mat({ id: i + 1, number: i + 1, current: sampleMatch({ id: 100 + i }) }))
      expect(boardPlan(sampleSnapshot({ mats }), empty)).toEqual({ comp: 'mats', mats: n })
    }
  })

  it('clamps above four mats and below one', () => {
    const many = Array.from({ length: 6 }, (_, i) => mat({ id: i + 1, number: i + 1 }))
    expect(boardPlan(sampleSnapshot({ mats: many, matches: [] }), empty).mats).toBe(4)
    expect(boardPlan(sampleSnapshot({ mats: [], matches: [] }), empty).mats).toBe(1)
  })

  it('is data entry when no mat carries a match and results exist', () => {
    const done = sampleMatch({ id: 2, status: 'done' })
    const snapshot = sampleSnapshot({ mats: [mat({ id: 1, number: 1 })], matches: [done] })
    expect(boardPlan(snapshot, empty).comp).toBe('entry')
  })

  it('stays on the mat band while a mat is still holding a finished result', () => {
    const done = sampleMatch({ id: 2, status: 'done' })
    const snapshot = sampleSnapshot({ mats: [mat({ id: 1, number: 1 })], matches: [done] })
    expect(boardPlan(snapshot, new Map([[1, done]])).comp).toBe('mats')
  })

  it('is the setup mat band when nothing has been scored yet', () => {
    const snapshot = sampleSnapshot({
      event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'setup', matCount: 2 },
      mats: [mat({ id: 1, number: 1, onDeck: [sampleMatch({ id: 5, status: 'pending' })] }), mat({ id: 2, number: 2 })],
      matches: [],
    })
    expect(boardPlan(snapshot, empty)).toEqual({ comp: 'mats', mats: 2 })
  })

  it('is the done composition once the event closes', () => {
    const snapshot = sampleSnapshot({ event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'done', matCount: 1 } })
    expect(boardPlan(snapshot, empty).comp).toBe('done')
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
