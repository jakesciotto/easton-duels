import { useEffect, useState } from 'react'
import type { Snapshot } from '@shared/types'

export interface StreamState { snapshot: Snapshot | null; connected: boolean }

export function mergeSnapshot(prev: Snapshot | null, next: Snapshot): Snapshot {
  return prev && prev.version > next.version ? prev : next
}

export function useSnapshot(eventId: number | null): StreamState {
  const [state, setState] = useState<StreamState>({ snapshot: null, connected: false })

  useEffect(() => {
    if (eventId === null) return
    let ignore = false
    const es = new EventSource(`/api/events/${eventId}/stream`)
    es.addEventListener('snapshot', e => {
      if (ignore) return
      const next = JSON.parse((e as MessageEvent).data) as Snapshot
      setState(s => ({ snapshot: mergeSnapshot(s.snapshot, next), connected: true }))
    })
    es.onerror = () => {
      if (!ignore) setState(s => ({ ...s, connected: false }))
    }
    return () => {
      ignore = true
      es.close()
    }
  }, [eventId])

  return state
}
