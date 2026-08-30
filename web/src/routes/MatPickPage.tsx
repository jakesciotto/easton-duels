import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { Snapshot } from '@shared/types'
import { api, ApiError } from '@/lib/api'
import { clearMatBinding, getMatBinding, setMatBinding } from '@/lib/auth'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { List, ListRow } from '@/components/ui/list'

export default function MatPickPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [eventId, setEventId] = useState(params.get('event') ?? '')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [matId, setMatId] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [binding, setBinding] = useState(() => getMatBinding())

  useEffect(() => {
    if (!eventId) return
    let ignore = false
    setError(null)
    api<Snapshot>(`/api/events/${eventId}/board`)
      .then(s => { if (!ignore) setSnapshot(s) })
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

  if (binding) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <Card className="w-full max-w-sm">
          <CardContent className="grid gap-4 text-center">
            <h1 className="text-[22px] font-semibold tracking-[-0.035em]">This iPad is bound to Mat {binding.matNumber}</h1>
            <p className="text-sm text-soft">{binding.eventName}</p>
            <div className="grid gap-2">
              <Link to={`/mat/${binding.matId}`} className={buttonVariants({ size: 'lg' })}>Open scorer</Link>
              <Button size="lg" variant="destructive" onClick={() => { clearMatBinding(); setBinding(null) }}>Unbind this device</Button>
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="grid gap-4">
          <h1 className="text-[22px] font-semibold tracking-[-0.035em]">Pick your mat</h1>
          {!params.get('event') && (
            <div className="grid gap-1.5">
              <Label htmlFor="ev">Event number</Label>
              <Input
                id="ev"
                inputMode="numeric"
                value={eventId}
                onChange={e => setEventId(e.target.value.replace(/\D/g, ''))}
                className="font-mono tabular"
              />
            </div>
          )}
          {snapshot && <p className="text-[13px] text-soft">{snapshot.event.name}</p>}
          {snapshot && snapshot.mats.length > 0 && (
            <List>
              {snapshot.mats.map(m => (
                <ListRow key={m.id} className="flex items-center justify-between gap-3">
                  <span className="font-medium">Mat {m.number}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-pressed={matId === m.id}
                    aria-label={`Bind mat ${m.number}`}
                    onClick={() => setMatId(m.id)}
                    className="aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                  >
                    Bind
                  </Button>
                </ListRow>
              ))}
            </List>
          )}
          <form onSubmit={bind} className="grid gap-3">
            <Label htmlFor="code">Mat code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center font-mono text-3xl tabular tracking-[0.4em]"
            />
            {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy || matId === null || code.length !== 4}>
              Bind this iPad
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
