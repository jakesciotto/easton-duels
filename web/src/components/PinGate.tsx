import { useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError } from '@/lib/api'
import { setAdminToken } from '@/lib/auth'
import { useAdminToken } from '@/lib/useAdminToken'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function PinGate({ children }: { children: ReactNode }) {
  const token = useAdminToken()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (token) return <>{children}</>

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
      <form onSubmit={submit} className="grid w-full max-w-[360px] gap-4 rounded-lg border border-border bg-card p-5">
        <div className="grid justify-items-start gap-2">
          <img src="/easton-logo.png" alt="Easton Training Center" width={40} height={40} className="size-10 rounded-full" />
          <Wordmark />
          <h1 className="text-[22px] font-semibold tracking-[-0.035em]">Admin</h1>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pin">PIN</Label>
          <Input id="pin" inputMode="numeric" autoComplete="off" maxLength={6} autoFocus value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="font-mono tracking-[0.4em] tabular-nums" />
        </div>
        {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || pin.length !== 6}>Continue</Button>
      </form>
    </main>
  )
}
