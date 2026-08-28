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

export class FakeEventSource {
  static instances: FakeEventSource[] = []
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>()
  onerror: ((e: Event) => void) | null = null
  closed = false
  url: string
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb])
  }
  close() { this.closed = true }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners.get(type) ?? []) cb({ data: JSON.stringify(data) } as MessageEvent)
  }
  fail() { this.onerror?.(new Event('error')) }
}

export function sampleMatch(over: Partial<MatchView> = {}): MatchView {
  return {
    id: 10, orderIndex: 0, matId: 1, status: 'live', rulesetId: 1, lengthSec: 300, why: null,
    a: { athleteId: 100, name: 'Mateo Rivera', teamId: 1, belt: 'grey', weightLbs: 62, score: 0 },
    b: { athleteId: 200, name: 'Olivia Kim', teamId: 2, belt: 'grey-white', weightLbs: 60, score: 0 },
    clock: { elapsedMs: 0, startedAt: null, lengthMs: 300_000 },
    result: null, pendingTerminal: null, lastSeq: 0, ...over,
  }
}

export function sampleSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  const match = sampleMatch()
  return {
    version: 1, now: '2026-10-03T16:00:00.000Z',
    event: { id: 1, name: 'Fall Duels', date: '2026-10-03', status: 'live', matCount: 1 },
    teams: [
      { id: 1, name: 'Boulder', color: 'red', position: 0, wins: 0, points: 0 },
      { id: 2, name: 'Denver', color: 'blue', position: 1, wins: 0, points: 0 },
    ],
    rulesets: [{ id: 1, name: 'Default', defaultLengthSec: 300,
      actions: [{ key: 'takedown', label: 'Takedown', points: 2 }, { key: 'mount', label: 'Mount', points: 4 }, { key: 'penalty', label: 'Penalty', points: -1 }],
      terminals: [{ key: 'submission', label: 'Submission', winType: 'submission' }, { key: 'pin', label: 'Pin', winType: 'submission' }] }],
    mats: [{ id: 1, number: 1, current: match, onDeck: [], bound: false }],
    matches: [match],
    ...over,
  }
}
