import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '@/lib/api'
import { QrCode } from '@/components/QrCode'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ConnectPage() {
  const [params] = useSearchParams()
  const [eventId, setEventId] = useState(params.get('event') ?? '')
  // The organizer opens this page on the laptop, often at localhost, which is useless to an
  // iPad. The server knows its own LAN address, so ask it and only fall back to this page's
  // origin if that fails.
  const [origin, setOrigin] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    api<{ url: string }>('/api/lan')
      .then(r => { if (!ignore) setOrigin(r.url) })
      .catch(() => { if (!ignore) setOrigin(window.location.origin) })
    return () => { ignore = true }
  }, [])

  const target = origin ? `${origin}/mat?event=${eventId}` : ''

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="grid gap-4 text-center">
          <h1 className="text-[22px] font-semibold tracking-[-0.035em]">Connect an iPad</h1>
          {!eventId ? (
            <div className="grid gap-1.5 text-left">
              <Label htmlFor="ev">Event number</Label>
              <Input
                id="ev"
                inputMode="numeric"
                value={eventId}
                onChange={e => setEventId(e.target.value.replace(/\D/g, ''))}
                className="font-mono tabular"
              />
            </div>
          ) : !target ? (
            <p className="text-[13px] text-faint">Finding the server address</p>
          ) : (
            <>
              <QrCode text={target} size={240} />
              <p className="break-all font-mono text-2xl text-foreground">{target}</p>
              <p className="text-[13px] text-faint">Scan, pick your mat, and enter the mat code from the organizer.</p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
