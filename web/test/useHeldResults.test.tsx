import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useHeldResults } from '@/routes/board/useHeldResults'
import { sampleMatch, sampleSnapshot } from './fakes'

describe('useHeldResults', () => {
  it('keeps the finished match a mat has moved on from', () => {
    const live = sampleMatch({ id: 10 })
    const first = sampleSnapshot({ mats: [{ id: 1, number: 1, current: live, onDeck: [], bound: true }], matches: [live] })
    const finished = { ...live, status: 'done' as const, result: { winnerAthleteId: 100, winType: 'submission' as const } }
    const second = sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: true }], matches: [finished] })

    const { result, rerender } = renderHook(({ s }) => useHeldResults(s), { initialProps: { s: first } })
    expect(result.current.size).toBe(0)
    rerender({ s: second })
    expect(result.current.get(1)?.id).toBe(10)
  })

  it('drops the held result once a new match starts on that mat', () => {
    const live = sampleMatch({ id: 10 })
    const finished = { ...live, status: 'done' as const, result: { winnerAthleteId: 100, winType: 'submission' as const } }
    const next = sampleMatch({ id: 11 })
    const first = sampleSnapshot({ mats: [{ id: 1, number: 1, current: live, onDeck: [], bound: true }], matches: [live] })
    const second = sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: true }], matches: [finished] })
    const third = sampleSnapshot({ mats: [{ id: 1, number: 1, current: next, onDeck: [], bound: true }], matches: [finished, next] })

    const { result, rerender } = renderHook(({ s }) => useHeldResults(s), { initialProps: { s: first } })
    rerender({ s: second })
    expect(result.current.has(1)).toBe(true)
    rerender({ s: third })
    expect(result.current.has(1)).toBe(false)
  })

  it('ignores a match that left the mat without finishing', () => {
    const live = sampleMatch({ id: 10 })
    const skipped = { ...live, status: 'pending' as const }
    const first = sampleSnapshot({ mats: [{ id: 1, number: 1, current: live, onDeck: [], bound: true }], matches: [live] })
    const second = sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: true }], matches: [skipped] })

    const { result, rerender } = renderHook(({ s }) => useHeldResults(s), { initialProps: { s: first } })
    rerender({ s: second })
    expect(result.current.size).toBe(0)
  })
})
