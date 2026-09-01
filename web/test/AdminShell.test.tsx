import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AdminShell } from '@/components/AdminShell'

const T0 = Date.parse('2026-10-03T16:00:00.000Z')

afterEach(() => vi.useRealTimers())

function mount(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

// Finding 3: no current caller (EventPage, AdminPage) passes `freshness`, so the shell must
// never fabricate a status it has no data for. These tests pin the honest degrade contract:
// absent data means no status region at all, never a permanently "fresh" one.
describe('AdminShell freshness readout', () => {
  it('renders no status region at all when freshness is not passed', () => {
    mount(<AdminShell title="Events">content</AdminShell>)
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
    expect(screen.queryByText('Connecting')).not.toBeInTheDocument()
  })

  it('reads Connecting, not a fabricated Live, before any poll has landed', () => {
    vi.useFakeTimers({ now: T0 })
    mount(<AdminShell title="Event" freshness={{ lastSuccessAt: null, pollIntervalMs: 2000 }}>content</AdminShell>)
    expect(screen.getByText('Connecting')).toBeInTheDocument()
    expect(screen.queryByText(/^Live/)).not.toBeInTheDocument()
  })

  it('is the neutral tone under 5 seconds old', () => {
    vi.useFakeTimers({ now: T0 })
    mount(<AdminShell title="Event" freshness={{ lastSuccessAt: T0 - 2_000, pollIntervalMs: 2000 }}>content</AdminShell>)
    const el = screen.getByText('2s')
    expect(el.parentElement).toHaveClass('text-gray-11')
  })

  it('degrades to attend past 5 seconds', () => {
    vi.useFakeTimers({ now: T0 })
    mount(<AdminShell title="Event" freshness={{ lastSuccessAt: T0 - 6_000, pollIntervalMs: 2000 }}>content</AdminShell>)
    const el = screen.getByText('6s')
    expect(el.parentElement).toHaveClass('text-attend')
  })

  it('degrades to fault past 15 seconds', () => {
    vi.useFakeTimers({ now: T0 })
    mount(<AdminShell title="Event" freshness={{ lastSuccessAt: T0 - 16_000, pollIntervalMs: 2000 }}>content</AdminShell>)
    const el = screen.getByText('16s')
    expect(el.parentElement).toHaveClass('text-fault')
  })
})

// Finding 4: the footer band is an owner-set line with no data source yet, so the shell
// must never fabricate one -- same honest-absence contract as freshness above.
describe('AdminShell footer band', () => {
  it('renders no footer band when none is passed', () => {
    mount(<AdminShell title="Events">content</AdminShell>)
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })

  it('renders the passed footer content in a footer band', () => {
    mount(<AdminShell title="Events" footer="Questions at the desk: Sam, 555-0100">content</AdminShell>)
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Questions at the desk: Sam, 555-0100')
  })
})
