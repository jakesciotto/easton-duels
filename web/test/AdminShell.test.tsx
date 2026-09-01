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

  // A healthy app says it is live and prints no number: the age is always under one poll
  // interval, so a figure there counts up and resets on every poll and reports nothing.
  it('says Live with no age while the polls are landing', () => {
    vi.useFakeTimers({ now: T0 })
    mount(<AdminShell title="Event" freshness={{ lastSuccessAt: T0 - 2_000, pollIntervalMs: 2000 }}>content</AdminShell>)
    const banner = screen.getByRole('banner')
    expect(banner).toHaveTextContent('Live')
    expect(banner).not.toHaveTextContent(/\ds/)
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

// 4.4 / WCAG 2.2.2: the poll keeps running while the operator has stopped the picture, so
// a header driven by lastSuccessAt alone would read "Live 1s" over a screen that has not
// moved since they pressed the button. The two must not disagree.
describe('AdminShell freshness readout while the stream is paused', () => {
  it('reads paused with the count waiting instead of a fresh age', () => {
    vi.useFakeTimers({ now: T0 })
    mount(<AdminShell title="Event" freshness={{ lastSuccessAt: T0 - 1_000, pollIntervalMs: 1000, paused: true, waiting: 3 }}>content</AdminShell>)
    expect(screen.getByRole('banner')).toHaveTextContent('Paused, 3 updates waiting')
    expect(screen.getByRole('banner')).not.toHaveTextContent('1s')
  })

  it('says update rather than updates when exactly one is waiting', () => {
    vi.useFakeTimers({ now: T0 })
    mount(<AdminShell title="Event" freshness={{ lastSuccessAt: T0 - 1_000, pollIntervalMs: 1000, paused: true, waiting: 1 }}>content</AdminShell>)
    expect(screen.getByRole('banner')).toHaveTextContent('Paused, 1 update waiting')
  })

  it('goes back to the age readout when the pause is released', () => {
    vi.useFakeTimers({ now: T0 })
    const { rerender } = mount(<AdminShell title="Event" freshness={{ lastSuccessAt: T0 - 2_000, pollIntervalMs: 1000, paused: true, waiting: 2 }}>content</AdminShell>)
    rerender(<MemoryRouter><AdminShell title="Event" freshness={{ lastSuccessAt: T0 - 2_000, pollIntervalMs: 1000, paused: false, waiting: 0 }}>content</AdminShell></MemoryRouter>)
    expect(screen.getByRole('banner')).not.toHaveTextContent('waiting')
    expect(screen.getByRole('banner')).toHaveTextContent('Live')
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
