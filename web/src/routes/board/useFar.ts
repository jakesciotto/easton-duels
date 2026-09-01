import { useEffect, useState } from 'react'

const KEY = 'duels.board.far'
// 3.4 names three settings and no others. The clamp is the same range on purpose: the
// safe frame is a fixed 90cqh while every step inside it scales, so past 1.2 a
// composition can no longer hold its own type and a ?far= typed by hand would buy a
// board that has to shrink something to fit. Read, not just written, so a value
// persisted by an earlier build comes back inside the range.
const STEPS = [0.85, 1, 1.2]
const MIN = STEPS[0]
const MAX = STEPS[STEPS.length - 1]

function clamp(value: number): number {
  return Math.min(MAX, Math.max(MIN, value))
}

function read(): number {
  if (typeof window === 'undefined') return 1
  const fromQuery = Number(new URLSearchParams(window.location.search).get('far'))
  if (Number.isFinite(fromQuery) && fromQuery > 0) return clamp(fromQuery)
  const stored = Number(window.localStorage?.getItem(KEY))
  return Number.isFinite(stored) && stored > 0 ? clamp(stored) : 1
}

/**
 * The board's hardware assumption, made explicit. Set once at the dress rehearsal from
 * a measured panel diagonal and seating depth, and never touched on event day: the
 * motion deny list names --far specifically.
 */
export function useFar(): number {
  // Read on the first render, not in an effect: the board is a television that is opened
  // once and left, so a first paint at 1.00 followed by a resize to the calibrated value
  // is a visible relayout in front of the room for no gain.
  const [far, setFar] = useState(read)

  // 3.4: the knob persists. A `?far=` on the URL is how it is set at the dress rehearsal,
  // so it has to survive the next plain visit to /board/:id, not just the tab it was
  // typed into.
  useEffect(() => {
    try { window.localStorage?.setItem(KEY, String(far)) } catch { /* private mode */ }
  }, [far])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '+' && e.key !== '=' && e.key !== '-' && e.key !== '_') return
      const step = e.key === '-' || e.key === '_' ? -1 : 1
      setFar(current => {
        let nearest = 0
        for (let i = 1; i < STEPS.length; i += 1) {
          if (Math.abs(STEPS[i] - current) < Math.abs(STEPS[nearest] - current)) nearest = i
        }
        return STEPS[Math.min(STEPS.length - 1, Math.max(0, nearest + step))]
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return far
}
