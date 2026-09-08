import { useEffect, useRef, useState } from 'react'
import type { Snapshot } from '@shared/types'
import { getAdminToken } from '@/lib/auth'
import { adminApi } from '@/lib/queries'

const KEY = 'duels.board.far'
// 3.4 names three settings and no others. The clamp is the same range on purpose: the
// safe frame is a fixed 90cqh while every step inside it scales, so past 1.2 a
// composition can no longer hold its own type and a ?far= typed by hand would buy a
// board that has to shrink something to fit. Read, not just written, so a value
// persisted by an earlier build comes back inside the range.
export const FAR_STEPS = [0.85, 1, 1.2]
const MIN = FAR_STEPS[0]
const MAX = FAR_STEPS[FAR_STEPS.length - 1]

function clamp(value: number): number {
  return Math.min(MAX, Math.max(MIN, value))
}

/**
 * The event's own far setting, or null where it carries none.
 *
 * Read through one loose accessor because the column lands with the server work and this
 * file has to compile and behave correctly on both sides of that merge: an event that
 * does not carry the field reads as an event that has not been given one, which is the
 * same answer and the same fallback.
 */
export function farOf(snapshot: { event: unknown } | null | undefined): number | null {
  return (snapshot?.event as { far?: number | null } | undefined)?.far ?? null
}

function fromQuery(): number | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('far')
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? clamp(value) : null
}

function fromStorage(): number | null {
  try {
    const value = Number(window.localStorage?.getItem(KEY))
    return Number.isFinite(value) && value > 0 ? clamp(value) : null
  } catch {
    return null
  }
}

function readLocal(): number {
  if (typeof window === 'undefined') return 1
  return fromQuery() ?? fromStorage() ?? 1
}

/**
 * The board's hardware assumption, made explicit. Set once at the dress rehearsal from
 * a measured panel diagonal and seating depth, and never touched on event day: the
 * motion deny list names --far specifically.
 *
 * G24: it lived in one browser, so a second television, a cleared cache or a laptop
 * somebody swapped in reverted to 1.00 in front of the room. The event owns it now. The
 * query string and the plus and minus keys stay the local setter for an event that has
 * not been given one, and on a page that holds an admin token the query string writes
 * the event instead of this browser.
 */
export function useFar(snapshot: Snapshot | null): number {
  // Read on the first render, not in an effect: the board is a television that is opened
  // once and left, so a first paint at 1.00 followed by a resize to the calibrated value
  // is a visible relayout in front of the room for no gain.
  const [local, setLocal] = useState(readLocal)
  const stored = farOf(snapshot)
  const far = stored === null ? local : clamp(stored)

  // 3.4: the knob persists. A `?far=` on the URL is how it is set at the dress rehearsal,
  // so it has to survive the next plain visit to /board/:id, not just the tab it was
  // typed into.
  useEffect(() => {
    try { window.localStorage?.setItem(KEY, String(far)) } catch { /* private mode */ }
  }, [far])

  // One write per event per value. A board with no admin token, which is every television
  // in the room, reads the event and writes nothing.
  const eventId = snapshot?.event.id ?? null
  const written = useRef<string | null>(null)
  useEffect(() => {
    const wanted = fromQuery()
    if (eventId === null || wanted === null || !getAdminToken()) return
    const once = `${eventId}:${wanted}`
    if (written.current === once) return
    written.current = once
    adminApi(`/api/events/${eventId}`, { method: 'PATCH', body: { far: wanted } }).catch(() => {})
  }, [eventId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '+' && e.key !== '=' && e.key !== '-' && e.key !== '_') return
      const step = e.key === '-' || e.key === '_' ? -1 : 1
      setLocal(current => {
        let nearest = 0
        for (let i = 1; i < FAR_STEPS.length; i += 1) {
          if (Math.abs(FAR_STEPS[i] - current) < Math.abs(FAR_STEPS[nearest] - current)) nearest = i
        }
        return FAR_STEPS[Math.min(FAR_STEPS.length - 1, Math.max(0, nearest + step))]
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return far
}
