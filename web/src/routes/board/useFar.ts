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
  const [far, setFar] = useState(1)

  useEffect(() => { setFar(read()) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '+' && e.key !== '=' && e.key !== '-' && e.key !== '_') return
      const step = e.key === '-' || e.key === '_' ? -1 : 1
      setFar(current => {
        let nearest = 0
        for (let i = 1; i < STEPS.length; i += 1) {
          if (Math.abs(STEPS[i] - current) < Math.abs(STEPS[nearest] - current)) nearest = i
        }
        const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, nearest + step))]
        try { window.localStorage?.setItem(KEY, String(next)) } catch { /* private mode */ }
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return far
}
