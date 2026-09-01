import { useEffect } from 'react'
import { useParams } from 'react-router'
import { useSnapshot } from '@/lib/useSnapshot'
import { useWakeLock } from '@/lib/useWakeLock'
import { Board } from './board/Board'

export default function BoardPage() {
  const { eventId } = useParams()
  const { snapshot, connected, lastSuccessAt } = useSnapshot(eventId ? Number(eventId) : null)
  const { active, failed, request } = useWakeLock()

  // Section 9 names a slept screen as the most likely total failure of the event day: a
  // panel that sleeps on its OS timer never fires a visibility event again, so nothing
  // recovers it and somebody has to walk to the television. Ask on mount, which is all
  // Chromium needs, and again on any gesture, because Safari refuses the request outside
  // a user activation. Once the lock is held this effect stops asking.
  //
  // There is no in-flight guard here on purpose. useWakeLock holds one, and it covers
  // the visibilitychange re-acquire this page cannot see, so a second guard beside it
  // would only be a second thing to keep true.
  useEffect(() => {
    if (active) return
    const ask = () => { void request() }
    ask()
    window.addEventListener('pointerdown', ask)
    window.addEventListener('keydown', ask)
    return () => {
      window.removeEventListener('pointerdown', ask)
      window.removeEventListener('keydown', ask)
    }
  }, [active, request])

  return (
    <Board
      snapshot={snapshot}
      connected={connected}
      lastSuccessAt={lastSuccessAt}
      screenMaySleep={failed && !active}
    />
  )
}
