import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { Snapshot } from '@shared/types'
import { api, ApiError } from '@/lib/api'
import { clearMatBinding, getMatBinding, setMatBinding } from '@/lib/auth'
import { useWakeLock } from '@/lib/useWakeLock'
import { unlockAudio } from '@/lib/sounds'
import { CodeField } from '@/components/CodeField'
import { Button, buttonVariants } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'

// 6.17b: a FLOOR of 4, not a fixed count, so mat 2 sits in the same grid cell whether
// the event runs 2 mats or 4 -- a thumb learns a position and the position never moves.
// events.ts accepts matCount up to 8, so an event with more than 4 mats grows the grid
// past the floor rather than hiding mats 5 and up with no toggle and no explanation.
const MIN_MAT_SLOTS = 4

// 6.17b's guard. 900 CSS px is a device floor, not a breakpoint that should ever be
// crossed by resizing a desktop window, so it is read from matchMedia rather than from
// a CSS class -- the fallback copy below is different markup, not a hidden variant of
// the same one.
const GUARD_QUERY = '(min-width: 900px) and (orientation: landscape)'

function isBindableViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  try {
    return window.matchMedia(GUARD_QUERY).matches
  } catch {
    return true
  }
}

function TooSmallToScore({ eventId }: { eventId: number | null }) {
  const boardUrl = eventId !== null && typeof window !== 'undefined' ? `${window.location.origin}/board/${eventId}` : null
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="grid max-w-sm gap-4 justify-items-center">
        <h1 className="t6 text-gray-12">Use a tablet for scoring</h1>
        {boardUrl && (
          <span className="max-w-full truncate rounded-sm bg-black px-4 py-2 t7 font-mono text-white">{boardUrl}</span>
        )}
      </div>
    </main>
  )
}

export default function MatPickPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const eventParam = params.get('event')
  const eventQueryId = eventParam ? Number(eventParam) : null
  const [eventId, setEventId] = useState(eventParam ?? '')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [matId, setMatId] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [binding, setBinding] = useState(() => getMatBinding())
  const [bindable, setBindable] = useState(isBindableViewport)
  const boundToCurrentEvent = binding !== null && (eventQueryId === null || binding.eventId === eventQueryId)
  const otherEventBinding = binding !== null && !boundToCurrentEvent ? binding : null

  // 6.17b / 7.15: the wake lock is acquired on the code-entry tap, which is the first
  // user gesture on this route. Safari refuses navigator.wakeLock.request() outside a
  // gesture, so this cannot move into an effect; requestedRef stops a refocus of the
  // code field from firing a second request once one is already in flight or held.
  // Audio needs the same gesture to unlock on iOS (4.1), so the same tap covers both.
  const wakeLock = useWakeLock()
  const requestedRef = useRef(false)
  const onCodeEntryTap = () => {
    if (requestedRef.current) return
    requestedRef.current = true
    void wakeLock.request()
    unlockAudio()
  }

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    let mq: MediaQueryList
    try {
      mq = window.matchMedia(GUARD_QUERY)
    } catch {
      return
    }
    const onChange = () => setBindable(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!eventId) return
    let ignore = false
    setError(null)
    api<{ version: number; snapshot: Snapshot }>(`/api/events/${eventId}/snapshot`)
      .then(body => { if (!ignore) setSnapshot(body.snapshot) })
      .catch(e => { if (!ignore) setError(e instanceof ApiError ? e.message : 'Could not reach the server') })
    return () => { ignore = true }
  }, [eventId])

  const bind = async (e: FormEvent) => {
    e.preventDefault()
    if (matId === null || !snapshot) return
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ token: string; mat: { id: number; number: number }; event: { id: number; name: string } }>(
        `/api/events/${snapshot.event.id}/mats/${matId}/bind`,
        { method: 'POST', body: { code } },
      )
      setMatBinding({ eventId: r.event.id, matId: r.mat.id, matNumber: r.mat.number, eventName: r.event.name, token: r.token })
      navigate(`/mat/${r.mat.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  if (!bindable) return <TooSmallToScore eventId={eventQueryId ?? snapshot?.event.id ?? null} />

  if (binding && boundToCurrentEvent) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="grid w-full max-w-sm gap-4 rounded-lg border border-gray-7 bg-gray-2 p-4 text-center">
          <div className="grid gap-1">
            <h1 className="t6 text-gray-12">This iPad is bound to Mat {binding.matNumber}</h1>
            <p className="t3 text-gray-10">{binding.eventName}</p>
          </div>
          <div className="grid gap-2">
            <Link to={`/mat/${binding.matId}`} className={buttonVariants({ size: 'lg' })}>Open scorer</Link>
            <Button size="lg" variant="destructive" onClick={() => { clearMatBinding(); setBinding(null) }}>Unbind this device</Button>
          </div>
        </div>
      </main>
    )
  }

  const matSlotCount = Math.max(MIN_MAT_SLOTS, snapshot?.event.matCount ?? MIN_MAT_SLOTS)
  const matSlots = Array.from({ length: matSlotCount }, (_, i) => snapshot?.mats.find(m => m.number === i + 1) ?? null)

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="grid w-full max-w-md gap-4 rounded-lg border border-gray-7 bg-gray-2 p-4">
        <h1 className="t6 text-gray-12">Pick your mat</h1>
        {otherEventBinding && (
          <div className="grid gap-2">
            <Alert variant="attend" className="text-left">
              <AlertDescription>
                This device is bound to {otherEventBinding.eventName}, mat {otherEventBinding.matNumber}.
              </AlertDescription>
            </Alert>
            <Button
              size="sm"
              variant="destructive"
              className="justify-self-start"
              onClick={() => { clearMatBinding(); setBinding(null) }}
            >
              Unbind this device
            </Button>
          </div>
        )}
        {!eventParam && (
          <div className="grid gap-1.5">
            <Label htmlFor="ev">Event number</Label>
            <Input
              id="ev"
              inputMode="numeric"
              value={eventId}
              onChange={e => setEventId(e.target.value.replace(/\D/g, ''))}
              className="font-mono tabular-nums"
            />
          </div>
        )}
        {snapshot && <p className="t2 text-gray-10">{snapshot.event.name}</p>}
        {snapshot && (
          snapshot.mats.length > 0 ? (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Mat">
              {matSlots.map((m, i) => m ? (
                <Toggle
                  key={m.id}
                  size="mat"
                  className="w-full"
                  pressed={matId === m.id}
                  onPressedChange={() => setMatId(m.id)}
                >
                  Mat {m.number}
                </Toggle>
              ) : (
                <div key={`empty-${i}`} aria-hidden className="h-[104px]" />
              ))}
            </div>
          ) : (
            <EmptyState message="This event has no mats yet" />
          )
        )}
        <form onSubmit={bind} className="grid gap-3">
          <div className="grid gap-1.5" onPointerDown={onCodeEntryTap} onFocus={onCodeEntryTap}>
            <Label htmlFor="code">Mat code</Label>
            <CodeField id="code" length={4} aria-label="Mat code" value={code} onValueChange={setCode} />
          </div>
          {wakeLock.failed && (
            <Alert variant="attend">
              <AlertTitle variant="attend">Screen may sleep</AlertTitle>
              <AlertDescription>Disable auto-lock for this device and keep it plugged in.</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy || matId === null || code.length !== 4}>
            Bind this iPad
          </Button>
        </form>
      </div>
    </main>
  )
}
