import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { fakeFetch } from './fakes'

vi.mock('qrcode', () => ({ default: { toString: async () => '<svg>mock</svg>' } }))
afterEach(() => vi.unstubAllGlobals())

function mount(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

describe('ConnectPage', () => {
  it('builds the mat url from the server LAN address, not the browser origin', async () => {
    const f = fakeFetch(() => ({ json: { url: 'http://192.168.1.20:8422' } }))
    mount('/connect?event=7')
    expect(await screen.findByText('http://192.168.1.20:8422/mat?event=7')).toBeInTheDocument()
    expect(f.calls.some(c => c.url === '/api/lan')).toBe(true)
    expect(await screen.findByRole('img', { name: 'QR code' })).toBeInTheDocument()
  })

  it('falls back to this page origin when the server cannot say', async () => {
    fakeFetch(() => ({ status: 500, json: { error: { code: 'internal', message: 'internal error' } } }))
    mount('/connect?event=7')
    expect(await screen.findByText(`${window.location.origin}/mat?event=7`)).toBeInTheDocument()
  })

  it('asks for an event number when the url has none', async () => {
    fakeFetch(() => ({ json: { url: 'http://192.168.1.20:8422' } }))
    mount('/connect')
    const input = await screen.findByLabelText('Event number')
    await userEvent.setup().type(input, '7')
    expect(await screen.findByText('http://192.168.1.20:8422/mat?event=7')).toBeInTheDocument()
  })
})
