import { useEffect, useState } from 'react'
import type { Snapshot } from '@shared/types'

export interface StreamState { snapshot: Snapshot | null; connected: boolean }

export function mergeSnapshot(prev: Snapshot | null, next: Snapshot): Snapshot {
  return prev && prev.version > next.version ? prev : next
}

export function useSnapshot(eventId: number | null): StreamState {
  const [state, setState] = useState<StreamState>({ snapshot: null, connected: false })
  const [streaming, setStreaming] = useState(eventId)
  // Versions are per event and per server process, so nothing held for one event
  // can be compared against another event's stream.
  if (streaming !== eventId) {
    setStreaming(eventId)
    setState({ snapshot: null, connected: false })
  }

  useEffect(() => {
    if (eventId === null) return
    let ignore = false
    // The hub's version counter lives in memory and restarts at 0, so the first snapshot of
    // every connection is taken as the truth. The older-version guard only orders snapshots
    // within a single connection, which is the only place ordering can be assumed.
    let firstOfConnection = true
    const es = new EventSource(`/api/events/${eventId}/stream`)
    es.addEventListener('open', () => { firstOfConnection = true })
    es.addEventListener('snapshot', e => {
      if (ignore) return
      const next = JSON.parse((e as MessageEvent).data) as Snapshot
      const accept = firstOfConnection
      firstOfConnection = false
      setState(s => {
        const merged = accept ? next : mergeSnapshot(s.snapshot, next)
        return merged === s.snapshot ? s : { snapshot: merged, connected: true }
      })
    })
    es.onerror = () => {
      if (ignore) return
      firstOfConnection = true
      setState(s => ({ ...s, connected: false }))
    }
    return () => {
      ignore = true
      es.close()
    }
  }, [eventId])

  return state
}
