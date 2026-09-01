import { vi } from 'vitest'
import type { Snapshot, MatchView } from '@shared/types'

export type Reply = { status?: number; json?: unknown }
export function fakeFetch(handler: (url: string, init?: RequestInit) => Reply | Promise<Reply>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = await handler(String(url), init)
    const status = r.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(r.json ?? null), { status, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls, body: (i: number) => JSON.parse(String(calls[i].init?.body)) }
}

// Simulates the versioned snapshot endpoint that useSnapshot polls: `since` equal to the
// current version returns the lightweight `{ version, now }` shape, anything else returns
// the full snapshot. The version is server-owned here too -- push() always assigns the next
// one, so callers never have to keep a sample snapshot's version field in sync by hand.
export interface SnapshotFeed {
  push(next: Snapshot): void
  handle(url: string): Reply | undefined
}

export function snapshotFeed(initial: Snapshot): SnapshotFeed {
  let version = initial.version
  let current: Snapshot = initial
  return {
    push(next) {
      version += 1
      current = { ...next, version }
    },
    handle(url) {
      const m = /^\/api\/events\/\d+\/snapshot(?:\?since=(-?\d+))?$/.exec(url)
      if (!m) return undefined
      const since = m[1] === undefined ? -1 : Number(m[1])
      if (since === current.version) return { json: { version: current.version, now: current.now } }
      return { json: { version: current.version, snapshot: current } }
    },
  }
}

export function sampleMatch(over: Partial<MatchView> = {}): MatchView {
  return {
    id: 10, orderIndex: 0, matId: 1, status: 'live', rulesetId: 1, lengthSec: 300, why: null,
    a: { athleteId: 100, name: 'Mateo Rivera', teamId: 1, belt: 'grey', weightLbs: 62, score: 0 },
    b: { athleteId: 200, name: 'Olivia Kim', teamId: 2, belt: 'grey-white', weightLbs: 60, score: 0 },
    clock: { elapsedMs: 0, startedAt: null, lengthMs: 300_000 },
    result: null, pendingTerminal: null, endedAt: null, lastSeq: 0, ...over,
  }
}

export function sampleSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  const match = sampleMatch()
  return {
    version: 1, now: '2026-10-03T16:00:00.000Z',
    event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'live', matCount: 1 },
    teams: [
      { id: 1, name: 'Ridgeline', color: 'red', position: 0, wins: 0, points: 0 },
      { id: 2, name: 'Lakeside', color: 'blue', position: 1, wins: 0, points: 0 },
    ],
    rulesets: [{ id: 1, name: 'Default', defaultLengthSec: 300,
      actions: [{ key: 'takedown', label: 'Takedown', points: 2 }, { key: 'mount', label: 'Mount', points: 4 }, { key: 'penalty', label: 'Penalty', points: -1 }],
      terminals: [{ key: 'submission', label: 'Submission', winType: 'submission' }, { key: 'pin', label: 'Pin', winType: 'submission' }] }],
    mats: [{ id: 1, number: 1, current: match, onDeck: [], bound: false }],
    matches: [match],
    ...over,
  }
}
