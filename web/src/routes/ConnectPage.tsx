import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ApiError } from '@/lib/api'
import { adminApi } from '@/lib/queries'
import { PinGate } from '@/components/PinGate'
import { QrCode } from '@/components/QrCode'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// 6.17a: matCode lives behind /api/events/:id/connect (requireAdmin), so this page shows
// the PIN gate rather than falling back to /api/lan's url-only, unauthenticated shape.
interface ConnectInfo { url: string; matCode: string }

function Connect({ eventId }: { eventId: number }) {
  const [info, setInfo] = useState<ConnectInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    setInfo(null)
    setError(null)
    adminApi<ConnectInfo>(`/api/events/${eventId}/connect`)
      .then(r => { if (!ignore) setInfo(r) })
      .catch(err => { if (!ignore) setError(err instanceof ApiError ? err.message : 'Could not reach the server') })
    return () => { ignore = true }
  }, [eventId])

  const target = info ? `${info.url}/mat?event=${eventId}` : ''

  return (
    <div className="grid justify-items-center gap-6 text-center">
      {info ? <QrCode text={target} size={200} /> : <Skeleton className="size-[200px] rounded-lg" />}
      {info ? (
        <span className="max-w-[90vw] truncate rounded-sm bg-black px-4 py-2 t7 font-mono text-white">{target}</span>
      ) : (
        <Skeleton className="h-[38px] w-72" />
      )}
      {info ? (
        <span className="t9 text-gray-12">{info.matCode}</span>
      ) : (
        <Skeleton className="h-14 w-44" />
      )}
      {error && (
        <Alert className="w-fit text-left">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid max-w-sm gap-1 t2 text-gray-10">
        <p>Run the iPad in Guided Access: Settings, Accessibility, Guided Access, set a passcode, triple-click the side button, Start.</p>
        <p>Plug it in. A screen held awake for four hours will not finish the afternoon on a charge.</p>
      </div>
    </div>
  )
}

function ConnectBody() {
  const [params] = useSearchParams()
  const [eventId, setEventId] = useState(params.get('event') ?? '')
  const parsed = eventId ? Number(eventId) : null

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      {!parsed ? (
        <div className="grid w-full max-w-[360px] gap-1.5 rounded-lg border border-gray-7 bg-gray-2 p-4 text-left">
          <Label htmlFor="ev">Event number</Label>
          <Input
            id="ev"
            inputMode="numeric"
            value={eventId}
            onChange={e => setEventId(e.target.value.replace(/\D/g, ''))}
            className="font-mono tabular-nums"
          />
        </div>
      ) : (
        <Connect eventId={parsed} />
      )}
    </main>
  )
}

export default function ConnectPage() {
  return <PinGate><ConnectBody /></PinGate>
}
