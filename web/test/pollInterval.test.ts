import { describe, it, expect } from 'vitest'
import {
  pollIntervalForSnapshot,
  POLL_CLOCK_RUNNING_MS,
  POLL_LIVE_IDLE_MS,
  POLL_DATA_ENTRY_MS,
} from '@/lib/pollInterval'
import { sampleMatch, sampleSnapshot } from './fakes'

describe('pollIntervalForSnapshot', () => {
  it('polls fast before any snapshot has arrived', () => {
    expect(pollIntervalForSnapshot(null)).toBe(POLL_CLOCK_RUNNING_MS)
  })

  it('polls at the data entry rate when the event has no mats bound', () => {
    const snapshot = sampleSnapshot({ mats: [] })
    expect(pollIntervalForSnapshot(snapshot)).toBe(POLL_DATA_ENTRY_MS)
  })

  // The ramp used to guess the mode from whether any mat existed, which is wrong for the
  // normal desk event: an entry event still has mats, because they carry the running order
  // for the desk to read. The guess polled every desk screen five times faster than it needs
  // for a whole afternoon, and it was a second place answering a question the column answers.
  it('polls at the data entry rate for a desk event that still has its mats', () => {
    const running = sampleMatch({ clock: { elapsedMs: 0, startedAt: '2026-10-03T16:00:00.000Z', lengthMs: 300_000 } })
    const snapshot = sampleSnapshot({
      event: { ...sampleSnapshot().event, mode: 'entry' },
      mats: [{ id: 1, number: 1, current: running, onDeck: [], bound: true }],
    })
    expect(pollIntervalForSnapshot(snapshot)).toBe(POLL_DATA_ENTRY_MS)
  })

  it('polls at the live idle rate when mats exist and no clock is running', () => {
    const idle = sampleMatch({ clock: { elapsedMs: 0, startedAt: null, lengthMs: 300_000 } })
    const snapshot = sampleSnapshot({ mats: [{ id: 1, number: 1, current: idle, onDeck: [], bound: true }] })
    expect(pollIntervalForSnapshot(snapshot)).toBe(POLL_LIVE_IDLE_MS)
  })

  it('polls at the fast rate when any mat has a running clock', () => {
    const running = sampleMatch({ clock: { elapsedMs: 0, startedAt: '2026-10-03T16:00:00.000Z', lengthMs: 300_000 } })
    const idle = sampleMatch({ id: 11, clock: { elapsedMs: 0, startedAt: null, lengthMs: 300_000 } })
    const snapshot = sampleSnapshot({
      mats: [
        { id: 1, number: 1, current: idle, onDeck: [], bound: true },
        { id: 2, number: 2, current: running, onDeck: [], bound: true },
      ],
    })
    expect(pollIntervalForSnapshot(snapshot)).toBe(POLL_CLOCK_RUNNING_MS)
  })

  it('treats a mat with no current match as idle, not running', () => {
    const snapshot = sampleSnapshot({ mats: [{ id: 1, number: 1, current: null, onDeck: [], bound: false }] })
    expect(pollIntervalForSnapshot(snapshot)).toBe(POLL_LIVE_IDLE_MS)
  })
})
