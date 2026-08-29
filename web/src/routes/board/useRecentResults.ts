import { useEffect, useRef, useState } from 'react'
import type { MatchView, Snapshot } from '@shared/types'

export interface RecentResult { match: MatchView; at: number }
const HOLD_MS = 10_000

// Keeps a mat's just-finished match visible for HOLD_MS after the mat moved on.
export function useRecentResults(snapshot: Snapshot | null): Map<number, RecentResult> {
  const prev = useRef<Snapshot | null>(null)
  const [recent, setRecent] = useState<Map<number, RecentResult>>(new Map())

  useEffect(() => {
    if (!snapshot) return
    const before = prev.current
    prev.current = snapshot
    const now = Date.now()
    setRecent(old => {
      const next = new Map([...old].filter(([, r]) => now - r.at < HOLD_MS))
      if (before) {
        for (const mat of snapshot.mats) {
          const was = before.mats.find(m => m.id === mat.id)?.current
          if (!was || mat.current?.id === was.id) continue
          const finished = snapshot.matches.find(m => m.id === was.id)
          if (finished && finished.status === 'done') next.set(mat.id, { match: finished, at: now })
        }
      }
      return next
    })
  }, [snapshot])

  useEffect(() => {
    if (recent.size === 0) return
    const id = setTimeout(() => setRecent(old => new Map([...old].filter(([, r]) => Date.now() - r.at < HOLD_MS))), HOLD_MS + 50)
    return () => clearTimeout(id)
  }, [recent])

  return recent
}
