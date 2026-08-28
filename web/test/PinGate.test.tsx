import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PinGate } from '@/components/PinGate'
import { getAdminToken } from '@/lib/auth'
import { fakeFetch } from './fakes'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('PinGate', () => {
  it('asks for the PIN, stores the token, and renders children', async () => {
    const f = fakeFetch((_, init) => JSON.parse(String(init?.body)).pin === '123456'
      ? { json: { token: 'admin-tok' } }
      : { status: 401, json: { error: { code: 'bad_pin', message: 'wrong PIN' } } })
    render(<PinGate><p>secret area</p></PinGate>)
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Admin PIN'), '000000')
    await user.click(screen.getByRole('button', { name: 'Enter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('wrong PIN')
    await user.clear(screen.getByLabelText('Admin PIN'))
    await user.type(screen.getByLabelText('Admin PIN'), '123456')
    await user.click(screen.getByRole('button', { name: 'Enter' }))
    expect(await screen.findByText('secret area')).toBeInTheDocument()
    expect(getAdminToken()).toBe('admin-tok')
    expect(f.calls[0].url).toBe('/api/auth/admin')
  })
})
