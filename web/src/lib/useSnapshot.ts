import { useEffect, useState } from 'react'
import type { Snapshot } from '@shared/types'
import { pollIntervalForSnapshot } from './pollInterval'
import { operatorEngaged } from './operatorEngaged'

export interface StreamState { snapshot: Snapshot | null; connected: boolean; lastSuccessAt: number | null }

// How often the held-snapshot suspension (4.4) rechecks whether the operator is still
// engaged, once something is waiting to commit.
const SUSPENSION_RECHECK_MS = 200

export function useSnapshot(eventId: number | null, pollMs?: number): StreamState {
  const [state, setState] = useState<StreamState>({ snapshot: null, connected: false, lastSuccessAt: null })
  const [watching, setWatching] = useState(eventId)
  // Versions are per event, so nothing held for one event can be compared against another
  // event's poll.
  if (watching !== eventId) {
    setWatching(eventId)
    setState({ snapshot: null, connected: false, lastSuccessAt: null })
  }

  useEffect(() => {
    if (eventId === null) return
    let ignore = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let version = -1
    let inFlight = false

    // The newest snapshot known, whether or not it has been committed to state yet, and
    // what state currently holds -- kept apart so a hold never loses an even newer arrival
    // (4.4: "only the most recent one is kept").
    let latestData: Snapshot | null = null
    let committed: Snapshot | null = null
    let held = false
    let flushTimer: ReturnType<typeof setTimeout> | undefined

    const nextInterval = () => pollMs ?? pollIntervalForSnapshot(latestData)

    const flushToState = () => {
      if (latestData === committed) return
      committed = latestData
      setState(s => (latestData === s.snapshot ? s : { ...s, snapshot: latestData }))
    }

    const tryFlush = () => {
      if (!held || operatorEngaged()) return
      held = false
      flushToState()
    }

    const scheduleRecheck = () => {
      if (flushTimer) return
      flushTimer = setTimeout(() => {
        flushTimer = undefined
        tryFlush()
        if (held) scheduleRecheck()
      }, SUSPENSION_RECHECK_MS)
    }

    const tick = async () => {
      if (ignore || inFlight) return
      if (document.hidden) { timer = setTimeout(tick, nextInterval()); return }
      inFlight = true
      try {
        const res = await fetch(`/api/events/${eventId}/snapshot?since=${version}`)
        if (!res.ok) throw new Error(String(res.status))
        const body = await res.json() as { version: number; snapshot?: Snapshot }
        if (ignore) return
        failures = 0
        version = body.version
        if (body.snapshot) latestData = body.snapshot
        setState(s => ({ ...s, connected: true, lastSuccessAt: Date.now() }))
        if (operatorEngaged()) {
          held = true
          scheduleRecheck()
        } else {
          held = false
          flushToState()
        }
      } catch {
        if (ignore) return
        failures += 1
        if (failures >= 3) setState(s => (s.connected ? { ...s, connected: false } : s))
      } finally {
        inFlight = false
      }
      if (!ignore) timer = setTimeout(tick, nextInterval())
    }
    // A background tab's timers are throttled to about one tick a minute, so a locked iPad
    // or a TV that came out of its screensaver would keep rendering the previous match until
    // that late tick landed. Waking on visibilitychange polls at once instead -- but only when
    // no fetch is already in flight, or the same lock/unlock sequence starts a second poll
    // chain that never stops (the in-flight tick already schedules its own next timer).
    const wake = () => {
      if (ignore || document.hidden || inFlight) return
      if (timer) clearTimeout(timer)
      void tick()
    }
    document.addEventListener('visibilitychange', wake)
    void tick()
    return () => {
      ignore = true
      if (timer) clearTimeout(timer)
      if (flushTimer) clearTimeout(flushTimer)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [eventId, pollMs])

  return state
}
