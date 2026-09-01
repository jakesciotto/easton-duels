import { useEffect, useRef, useState } from 'react'
import type { MatchView, Snapshot } from '@shared/types'

function sameHeld(a: Map<number, MatchView>, b: Map<number, MatchView>): boolean {
  if (a.size !== b.size) return false
  for (const [id, match] of a) {
    const other = b.get(id)
    if (!other || other.id !== match.id || other.lastSeq !== match.lastSeq) return false
  }
  return true
}

/**
 * The finished match a mat should keep showing because the mat itself has moved on.
 * Unlike the previous revision this never expires: a mat holds its last result until a
 * new match starts on it, and the result goes monotone after the hold rather than
 * vanishing. A board with an empty row is a board nobody can read a result off.
 */
export function useHeldResults(snapshot: Snapshot | null): Map<number, MatchView> {
  const prev = useRef<Snapshot | null>(null)
  const [held, setHeld] = useState<Map<number, MatchView>>(() => new Map())

  useEffect(() => {
    if (!snapshot) return
    const before = prev.current
    prev.current = snapshot

    setHeld(old => {
      const next = new Map(old)
      for (const mat of snapshot.mats) {
        const carried = next.get(mat.id)
        // A new match on the mat replaces whatever it was holding.
        if (mat.current && carried && mat.current.id !== carried.id) next.delete(mat.id)

        const was = before?.mats.find(m => m.id === mat.id)?.current
        if (!was || mat.current?.id === was.id) continue
        const finished = snapshot.matches.find(m => m.id === was.id)
        if (finished && finished.status === 'done') next.set(mat.id, finished)
      }
      // A mat that vanished from the event takes its held result with it.
      for (const id of next.keys()) {
        if (!snapshot.mats.some(m => m.id === id)) next.delete(id)
      }
      return sameHeld(old, next) ? old : next
    })
  }, [snapshot])

  return held
}
