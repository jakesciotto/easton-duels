import { useCallback, useEffect, useRef, useState } from 'react'

export interface WakeLockState {
  supported: boolean
  active: boolean
  failed: boolean
  // Call from the caller's own gesture handler (6.17b's mat-code tap, the board's first
  // tap): Safari refuses navigator.wakeLock.request() outside a user gesture, so this
  // cannot be requested from an effect.
  request: () => Promise<void>
}

// 7.15. Feature detection degrades silently: older browsers with no Wake Lock API simply
// never show `failed`, per "feature detect it and degrade silently where the browser has
// no support."
export function useWakeLock(): WakeLockState {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  const lockRef = useRef<WakeLockSentinel | null>(null)
  const wantedRef = useRef(false)
  const [state, setState] = useState<{ active: boolean; failed: boolean }>({ active: false, failed: false })

  const request = useCallback(async () => {
    if (!supported) return
    wantedRef.current = true
    try {
      const lock = await navigator.wakeLock.request('screen')
      lockRef.current = lock
      setState({ active: true, failed: false })
      lock.addEventListener('release', () => {
        lockRef.current = null
        setState(s => ({ ...s, active: false }))
      })
    } catch {
      setState({ active: false, failed: true })
    }
  }, [supported])

  useEffect(() => {
    if (!supported) return
    // The OS releases the lock on hide without firing anything Safari lets us listen for
    // reliably beforehand, so re-acquiring on visibilitychange is the re-acquire rule.
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && wantedRef.current && lockRef.current === null) void request()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      wantedRef.current = false
      const lock = lockRef.current
      lockRef.current = null
      if (lock) void lock.release().catch(() => {})
    }
  }, [supported, request])

  return { supported, active: state.active, failed: state.failed, request }
}
