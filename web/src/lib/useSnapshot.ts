import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Snapshot } from '@shared/types'
import { pollIntervalForSnapshot } from './pollInterval'
import { useHeldWhileEngaged } from './operatorEngaged'

export interface StreamState {
  snapshot: Snapshot | null
  connected: boolean
  lastSuccessAt: number | null
  /**
   * 4.4 / WCAG 2.2.2: the operator has stopped the picture. The poll keeps running
   * underneath, so `waiting` can count what the frozen screen is behind by.
   */
  paused: boolean
  waiting: number
  setPaused: (on: boolean) => void
  /**
   * The newest snapshot, whether or not the picture is frozen. A write acts on the
   * room rather than on the picture, so it must carry the live sequence: a paused
   * screen can be several writes behind and the server rejects a stale one.
   */
  live: Snapshot | null
}

interface SharedStream { eventId: number; state: StreamState }

/**
 * One event, one poll loop, one pause.
 *
 * The shell's freshness readout and every tab under it describe the same data, so they
 * must come from the same stream: three independent loops against one endpoint from one
 * browser tab meant three request rates, three version cursors, and a header that reported
 * fresh data while the screen the operator was reading had been deliberately frozen.
 *
 * The event body provides this. A screen outside it -- the board, the scorer -- has no
 * provider above it and still polls on its own.
 */
export const SnapshotStreamContext = createContext<SharedStream | null>(null)

interface PollState { snapshot: Snapshot | null; connected: boolean; lastSuccessAt: number | null }

export function useSnapshot(eventId: number | null, pollMs?: number): StreamState {
  const shared = useContext(SnapshotStreamContext)
  const covered = eventId !== null && shared !== null && shared.eventId === eventId
  // Hooks stay unconditional: a covered caller mounts the loop with a null event, which
  // starts nothing, and reads the stream its provider already owns.
  const own = useOwnStream(covered ? null : eventId, pollMs)
  return covered ? shared.state : own
}

function useOwnStream(eventId: number | null, pollMs?: number): StreamState {
  const poll = usePoll(eventId, pollMs)
  // 4.4: what arrives is not what renders. The commit is suspended while the operator is
  // dragging, typing or holding a dialog open, by the same mechanism the event detail uses.
  const committed = useHeldWhileEngaged(poll.snapshot, eventId)

  const [frozen, setFrozen] = useState<Snapshot | null>(null)
  const shown = useRef(committed)
  shown.current = committed
  const setPaused = useCallback((on: boolean) => { setFrozen(on ? shown.current : null) }, [])
  // Versions are per event, so a freeze taken on one event can never be counted against
  // another event's poll.
  useEffect(() => { setFrozen(null) }, [eventId])

  const snapshot = frozen ?? committed
  const paused = frozen !== null
  const waiting = frozen !== null && poll.snapshot !== null ? Math.max(0, poll.snapshot.version - frozen.version) : 0

  return useMemo(
    () => ({ snapshot, connected: poll.connected, lastSuccessAt: poll.lastSuccessAt, paused, waiting, setPaused, live: committed }),
    [snapshot, poll.connected, poll.lastSuccessAt, paused, waiting, setPaused, committed],
  )
}

function usePoll(eventId: number | null, pollMs?: number): PollState {
  const [state, setState] = useState<PollState>({ snapshot: null, connected: false, lastSuccessAt: null })
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
    let latest: Snapshot | null = null

    const nextInterval = () => pollMs ?? pollIntervalForSnapshot(latest)

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
        if (body.snapshot) latest = body.snapshot
        setState({ snapshot: latest, connected: true, lastSuccessAt: Date.now() })
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
      document.removeEventListener('visibilitychange', wake)
    }
  }, [eventId, pollMs])

  return state
}
