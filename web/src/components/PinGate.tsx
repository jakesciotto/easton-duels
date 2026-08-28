import { useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError } from '@/lib/api'
import { setAdminToken } from '@/lib/auth'
import { useAdminToken } from '@/lib/useAdminToken'
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
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <h1 className="text-2xl font-bold">Easton Duels</h1>
        <div className="space-y-2">
          <Label htmlFor="pin">Admin PIN</Label>
          <Input id="pin" inputMode="numeric" autoComplete="off" maxLength={6} autoFocus value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className="font-mono text-lg tracking-[0.4em]" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || pin.length !== 6}>Enter</Button>
      </form>
    </main>
  )
}
