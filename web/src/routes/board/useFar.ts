import { useEffect, useState } from 'react'

const KEY = 'duels.board.far'
const STEPS = [0.85, 1, 1.2]
const MIN = 0.7
const MAX = 1.4

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
