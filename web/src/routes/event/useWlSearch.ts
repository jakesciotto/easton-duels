import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import { adminApi } from '@/lib/queries'
import type { RosterCandidate } from '@/lib/types'

/** One request per typed pause, not one per keystroke. */
export const SEARCH_PAUSE_MS = 300
const SEARCH_MIN_CHARS = 2
export const SEARCH_TOO_SHORT = 'Type at least two letters.'

export interface WlSearch {
  q: string
  setQ: (q: string) => void
  results: RosterCandidate[]
  pending: boolean
  /** The floor sentence while the query is too short, otherwise what went wrong. */
  error: string | null
}

/**
 * Spec 3.3 and 4. The cached pool is now the subset the last sync found, so the dialogs
 * that used to browse the gym ask WellnessLiving by name on demand instead.
 *
 * The floor lives here rather than in each field: a one character query has no tokens to
 * search on, so the client never sends it and the route's 422 is only a guard.
 */
export function useWlSearch(eventId: number): WlSearch {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<RosterCandidate[]>([])
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // The cleanup flag drops the answer to a query this hook has already moved off. The
  // counter is what survives a caller setting the query from an effect of its own while
  // a request is in flight: only a number that never goes backwards separates the two.
  const generation = useRef(0)

  const query = q.trim()
  const tooShort = query.length < SEARCH_MIN_CHARS

  useEffect(() => {
    generation.current += 1
    const mine = generation.current
    if (tooShort) {
      setResults([])
      setFailure(null)
      setPending(false)
      return
    }
    let ignore = false
    const fresh = () => !ignore && generation.current === mine
    setPending(true)
    const timer = window.setTimeout(() => {
      adminApi<RosterCandidate[]>(`/api/events/${eventId}/wl-search?q=${encodeURIComponent(query)}`)
        .then(rows => {
          if (!fresh()) return
          setResults(rows)
          setFailure(null)
          setPending(false)
        })
        .catch(e => {
          if (!fresh()) return
          setResults([])
          setFailure(e instanceof ApiError ? e.message : 'Could not reach the server')
          setPending(false)
        })
    }, SEARCH_PAUSE_MS)
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [eventId, query, tooShort])

  return { q, setQ, results, pending, error: tooShort ? SEARCH_TOO_SHORT : failure }
}
