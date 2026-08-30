import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { QrCode } from '@/components/QrCode'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ConnectPage() {
  const [params] = useSearchParams()
  const [eventId, setEventId] = useState(params.get('event') ?? '')
  const origin = window.location.origin
  const target = eventId ? `${origin}/mat?event=${eventId}` : ''

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="grid gap-4 text-center">
          <h1 className="text-[22px] font-semibold tracking-[-0.035em]">Connect an iPad</h1>
          {target ? (
            <>
              <QrCode text={target} size={240} />
              <p className="break-all font-mono text-sm text-soft">{target}</p>
              <p className="text-[13px] text-faint">Scan, pick your mat, and enter the mat code from the organizer.</p>
            </>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </main>
  )
}
