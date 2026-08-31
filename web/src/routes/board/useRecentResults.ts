import { useEffect, useRef, useState } from 'react'
import type { MatchView, Snapshot } from '@shared/types'

export interface RecentResult { match: MatchView; at: number }
const HOLD_MS = 10_000

// Newest finish first. A match without an endedAt (finished before the field existed)
// sorts after every match that has one, tie broken by id descending either way.
export function sortDoneMatches(matches: MatchView[]): MatchView[] {
  return [...matches].sort((x, y) => {
    if (x.endedAt === null && y.endedAt === null) return y.id - x.id
    if (x.endedAt === null) return 1
    if (y.endedAt === null) return -1
    if (x.endedAt !== y.endedAt) return x.endedAt < y.endedAt ? 1 : -1
    return y.id - x.id
  })
}

function sameEntries(a: Map<number, RecentResult>, b: Map<number, RecentResult>): boolean {
  if (a.size !== b.size) return false
  for (const [id, r] of a) {
    const other = b.get(id)
    if (!other || other.at !== r.at) return false
  }
  return true
}

function prune(entries: Map<number, RecentResult>, now: number): Map<number, RecentResult> {
  const next = new Map([...entries].filter(([, r]) => now - r.at < HOLD_MS))
  return sameEntries(entries, next) ? entries : next
}

// Keeps a mat's just-finished match visible for HOLD_MS after the mat moved on.
// The returned map keeps the same reference across snapshots that do not change
// which matches are showing, so the hold timer below is not rescheduled by
// unrelated snapshot updates (heartbeats, other mats' scores, etc).
export function useRecentResults(snapshot: Snapshot | null): Map<number, RecentResult> {
  const prev = useRef<Snapshot | null>(null)
  const [recent, setRecent] = useState<Map<number, RecentResult>>(new Map())

  useEffect(() => {
    if (!snapshot) return
    const before = prev.current
    prev.current = snapshot
    const now = Date.now()
    setRecent(old => {
      const next = prune(old, now)
      if (!before) return next
      const withFinishes = new Map(next)
      for (const mat of snapshot.mats) {
        const was = before.mats.find(m => m.id === mat.id)?.current
        if (!was || mat.current?.id === was.id) continue
        const finished = snapshot.matches.find(m => m.id === was.id)
        if (finished && finished.status === 'done') withFinishes.set(mat.id, { match: finished, at: now })
      }
      return sameEntries(next, withFinishes) ? next : withFinishes
    })
  }, [snapshot])

  useEffect(() => {
    if (recent.size === 0) return
    const earliest = Math.min(...[...recent.values()].map(r => r.at))
    const delay = Math.max(0, earliest + HOLD_MS - Date.now()) + 50
    const id = setTimeout(() => setRecent(old => prune(old, Date.now())), delay)
    return () => clearTimeout(id)
  }, [recent])

  return recent
}
