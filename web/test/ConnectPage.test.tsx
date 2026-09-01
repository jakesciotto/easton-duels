import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { setAdminToken } from '@/lib/auth'
import { fakeFetch } from './fakes'

vi.mock('qrcode', () => ({ default: { toString: async () => '<svg>mock</svg>' } }))
beforeEach(() => { localStorage.clear(); setAdminToken('tok') })
afterEach(() => vi.unstubAllGlobals())

function mount(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

describe('ConnectPage', () => {
  it('shows the QR, the LAN url, and the mat code from the admin connect endpoint', async () => {
    const f = fakeFetch(() => ({ json: { url: 'http://192.168.1.20:8422', matCode: '0420' } }))
    mount('/connect?event=7')
    expect(await screen.findByText('http://192.168.1.20:8422/mat?event=7')).toBeInTheDocument()
    expect(screen.getByText('0420')).toBeInTheDocument()
    expect(f.calls.some(c => c.url === '/api/events/7/connect')).toBe(true)
    expect(await screen.findByRole('img', { name: 'QR code' })).toBeInTheDocument()
  })

  it('asks for an event number when the url has none', async () => {
    fakeFetch(() => ({ json: { url: 'http://192.168.1.20:8422', matCode: '0420' } }))
    mount('/connect')
    const input = await screen.findByLabelText('Event number')
    await userEvent.setup().type(input, '7')
    expect(await screen.findByText('0420')).toBeInTheDocument()
  })

  it('shows the PIN gate rather than the connect info when not signed in', async () => {
    localStorage.clear()
    fakeFetch(() => ({ json: { url: 'http://192.168.1.20:8422', matCode: '0420' } }))
    mount('/connect?event=7')
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument()
    expect(screen.queryByText('0420')).not.toBeInTheDocument()
  })

  it('shows an error rather than a silent fallback when the connect info cannot be fetched', async () => {
    fakeFetch(() => ({ status: 500, json: { error: { code: 'internal', message: 'internal error' } } }))
    mount('/connect?event=7')
    expect(await screen.findByRole('alert')).toHaveTextContent('internal error')
  })
})
