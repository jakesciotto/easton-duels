import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'
import { setAdminToken } from '@/lib/auth'
import { DESK_NOTE, DESK_NOTE_DETAIL } from '@/lib/eventMode'
import { fakeFetch, sampleSnapshot } from './fakes'

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

  /**
   * This page's whole job is handing a mat code and a QR to a volunteer, and it read no
   * mode at all while the Live tab had already stopped showing a code in entry mode. A
   * volunteer scanned the QR here, walked to a mat, typed the code, and only there met a
   * Bind button the app had already decided to refuse.
   */
  it('states the desk mode in the Live tab words instead of a code and a QR', async () => {
    fakeFetch(url => {
      if (/\/snapshot(\?|$)/.test(url)) {
        return { json: { version: 1, snapshot: sampleSnapshot({
          event: { id: 7, name: 'Fall Duels', date: '2026-10-03', status: 'live', mode: 'entry', matCount: 1 },
        }) } }
      }
      return { json: { url: 'http://192.168.1.20:8422', matCode: '0420' } }
    })
    mount('/connect?event=7')
    expect(await screen.findByText(DESK_NOTE)).toBeInTheDocument()
    expect(screen.getByText(DESK_NOTE_DETAIL)).toBeInTheDocument()
    expect(screen.queryByText('0420')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'QR code' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Guided Access/)).not.toBeInTheDocument()
  })

  it('shows an error rather than a silent fallback when the connect info cannot be fetched', async () => {
    fakeFetch(() => ({ status: 500, json: { error: { code: 'internal', message: 'internal error' } } }))
    mount('/connect?event=7')
    expect(await screen.findByRole('alert')).toHaveTextContent('internal error')
  })
})
