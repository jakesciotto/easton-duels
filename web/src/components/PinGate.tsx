import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError } from '@/lib/api'
import { setAdminToken } from '@/lib/auth'
import { useAdminToken } from '@/lib/useAdminToken'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CodeField } from '@/components/CodeField'

export function PinGate({ children }: { children: ReactNode }) {
  const token = useAdminToken()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 6.1: a purely local signal that distinguishes an organizer who never signed in from one
  // whose 24 hour HMAC token was just cleared (by a 401, or by Sign out). Nothing upstream
  // marks a clear as an expiry, so this is the honest boundary reachable from this file alone.
  const hadToken = useRef(false)
  useEffect(() => {
    if (token) hadToken.current = true
  }, [token])

  if (token) return <>{children}</>

  const expired = hadToken.current

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ token: string }>('/api/auth/admin', { method: 'POST', body: { pin } })
      setAdminToken(r.token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <form onSubmit={submit} className="grid w-full max-w-[360px] gap-4 rounded-lg border border-gray-7 bg-gray-2 p-4">
        <div className="grid justify-items-start gap-2">
          <img src="/easton-logo.png" alt="Easton Training Center" width={40} height={40} className="size-10 rounded-full" />
          <Wordmark />
          <h1 className="t6 text-gray-12">Admin</h1>
        </div>
        {/* 6.1: same card, same field -- the destination route is never navigated away from,
            so re-authing lands the organizer back where they were rather than at the event list. */}
        {expired && <p className="t2 text-gray-11">Your session expired. Enter the PIN to continue.</p>}
        <div className="grid gap-1.5">
          <Label htmlFor="pin">PIN</Label>
          <CodeField id="pin" length={6} aria-label="PIN" value={pin} onValueChange={setPin} autoFocus />
        </div>
        {error && (
          <Alert>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={busy || pin.length !== 6}>Continue</Button>
      </form>
    </main>
  )
}
