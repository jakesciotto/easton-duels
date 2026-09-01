import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PinGate } from '@/components/PinGate'
import { getAdminToken, setAdminToken, clearAdminToken } from '@/lib/auth'
import { fakeFetch } from './fakes'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

// The admin token's payload is `{ role, exp }` base64url-encoded, unsigned client
// side and not secret (server/src/auth/tokens.ts); PinGate reads `exp` straight out
// of it, so a fake token only needs the same shape to exercise that path.
function fakeToken(expSec: number): string {
  const body = btoa(JSON.stringify({ role: 'admin', exp: expSec })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${body}.sig`
}

// The PIN field is six independent character wells (CodeField), not one input long enough
// to fake a length, so every well is addressed by index rather than by a shared label.
async function typePin(user: ReturnType<typeof userEvent.setup>, digits: string) {
  const wells = screen.getAllByRole('textbox')
  for (let i = 0; i < digits.length; i++) {
    await user.clear(wells[i])
    await user.type(wells[i], digits[i])
  }
}

describe('PinGate', () => {
  it('asks for the PIN across six wells, stores the token, and renders children', async () => {
    const f = fakeFetch((_, init) => JSON.parse(String(init?.body)).pin === '123456'
      ? { json: { token: 'admin-tok' } }
      : { status: 401, json: { error: { code: 'bad_pin', message: 'wrong PIN' } } })
    render(<PinGate><p>secret area</p></PinGate>)
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(6)
    const user = userEvent.setup()
    await typePin(user, '000000')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('wrong PIN')
    await typePin(user, '123456')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('secret area')).toBeInTheDocument()
    expect(getAdminToken()).toBe('admin-tok')
    expect(f.calls[0].url).toBe('/api/auth/admin')
  })

  it('never shows session expired copy on a fresh sign-in', () => {
    render(<PinGate><p>secret area</p></PinGate>)
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument()
  })

  it('shows session expired copy, not a bare error, when a token past its own exp is cleared', async () => {
    setAdminToken(fakeToken(Math.floor(Date.now() / 1000) - 60))
    render(<PinGate><p>secret area</p></PinGate>)
    expect(await screen.findByText('secret area')).toBeInTheDocument()
    // Stands in for the 401 that queries.ts's adminApi reacts to by clearing the token --
    // the gate must reappear on the same mounted instance, at the same route, explaining why.
    act(() => clearAdminToken())
    expect(await screen.findByText('Your session expired. Enter the PIN to continue.')).toBeInTheDocument()
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  // clearAdminToken() runs identically for a 401 (queries.ts) and for a deliberate
  // Sign out (AdminShell), so "a token was ever present" cannot tell them apart -- a
  // normal sign-out-then-sign-in wrongly claimed the session had expired.
  it('does not claim the session expired when a still-valid token is cleared by a sign out', async () => {
    setAdminToken(fakeToken(Math.floor(Date.now() / 1000) + 3600))
    render(<PinGate><p>secret area</p></PinGate>)
    expect(await screen.findByText('secret area')).toBeInTheDocument()
    act(() => clearAdminToken()) // mirrors AdminShell's Sign out button exactly
    await screen.findByRole('button', { name: 'Continue' })
    expect(screen.getAllByRole('textbox')).toHaveLength(6)
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument()
  })
})
