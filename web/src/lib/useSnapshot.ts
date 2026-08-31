import { useEffect, useState } from 'react'
import type { Snapshot } from '@shared/types'

export interface StreamState { snapshot: Snapshot | null; connected: boolean }

const POLL_MS = 1000

export function useSnapshot(eventId: number | null, pollMs = POLL_MS): StreamState {
  const [state, setState] = useState<StreamState>({ snapshot: null, connected: false })
  const [watching, setWatching] = useState(eventId)
  // Versions are per event, so nothing held for one event can be compared against another
  // event's poll.
  if (watching !== eventId) {
    setWatching(eventId)
    setState({ snapshot: null, connected: false })
  }

  useEffect(() => {
    if (eventId === null) return
    let ignore = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let version = -1

    const tick = async () => {
      if (ignore) return
      if (document.hidden) { timer = setTimeout(tick, pollMs); return }
      try {
        const res = await fetch(`/api/events/${eventId}/snapshot?since=${version}`)
        if (!res.ok) throw new Error(String(res.status))
        const body = await res.json() as { version: number; snapshot?: Snapshot }
        if (ignore) return
        failures = 0
        version = body.version
        setState(s => {
          const snapshot = body.snapshot ?? s.snapshot
          if (snapshot === s.snapshot && s.connected) return s
          return { snapshot, connected: true }
        })
      } catch {
        if (ignore) return
        failures += 1
        if (failures >= 3) setState(s => (s.connected ? { ...s, connected: false } : s))
      }
      timer = setTimeout(tick, pollMs)
    }
    void tick()
    return () => { ignore = true; if (timer) clearTimeout(timer) }
  }, [eventId, pollMs])

  return state
}
