import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ClockState } from '@shared/types'
import { Clock } from '@/components/Clock'

const T0 = Date.parse('2026-10-03T16:00:00.000Z')

afterEach(() => vi.useRealTimers())

function clock(over: Partial<ClockState>): ClockState {
  return { elapsedMs: 0, startedAt: null, lengthMs: 300_000, ...over }
}

describe('Clock', () => {
  it('is the calm neutral while running with time to spare, not green', () => {
    vi.useFakeTimers({ now: T0 })
    render(<Clock clock={clock({ startedAt: new Date(T0).toISOString() })} serverNow={new Date(T0).toISOString()} />)
    const el = screen.getByText('5:00')
    expect(el).toHaveClass('text-gray-11')
    expect(el).not.toHaveClass('text-fault', 'text-white', 'text-gray-10')
  })

  it('turns white, not amber, under thirty seconds', () => {
    vi.useFakeTimers({ now: T0 })
    render(<Clock clock={clock({ elapsedMs: 295_000, startedAt: new Date(T0).toISOString() })} serverNow={new Date(T0).toISOString()} />)
    const el = screen.getByText('0:05')
    expect(el).toHaveClass('text-white')
    expect(el).not.toHaveClass('text-attend')
  })

  it('is fault at 0:00', () => {
    vi.useFakeTimers({ now: T0 })
    render(<Clock clock={clock({ elapsedMs: 300_000, startedAt: null })} serverNow={new Date(T0).toISOString()} />)
    expect(screen.getByText('0:00')).toHaveClass('text-fault')
  })

  it('is the paused tone while paused and not expired', () => {
    vi.useFakeTimers({ now: T0 })
    render(<Clock clock={clock({ elapsedMs: 100_000, startedAt: null })} serverNow={new Date(T0).toISOString()} />)
    expect(screen.getByText('3:20')).toHaveClass('text-gray-10')
  })

  it('goes stale and prints the measured age once three poll intervals pass with no snapshot', () => {
    vi.useFakeTimers({ now: T0 })
    render(
      <Clock
        clock={clock({ startedAt: new Date(T0).toISOString() })}
        serverNow={new Date(T0).toISOString()}
        lastSuccessAt={T0 - 5_000}
        pollIntervalMs={1000}
      />,
    )
    expect(screen.getByText('5:00')).toHaveClass('text-gray-10')
    expect(screen.getByText('Not updating 5s')).toBeInTheDocument()
  })

  it('does not claim staleness before three poll intervals have passed', () => {
    vi.useFakeTimers({ now: T0 })
    render(
      <Clock
        clock={clock({ startedAt: new Date(T0).toISOString() })}
        serverNow={new Date(T0).toISOString()}
        lastSuccessAt={T0 - 2_000}
        pollIntervalMs={1000}
      />,
    )
    expect(screen.getByText('5:00')).toHaveClass('text-gray-11')
    expect(screen.queryByText(/Not updating/)).not.toBeInTheDocument()
  })

  it('holds a fixed four character slot for the digits', () => {
    vi.useFakeTimers({ now: T0 })
    render(<Clock clock={clock({ startedAt: new Date(T0).toISOString() })} serverNow={new Date(T0).toISOString()} />)
    expect(screen.getByText('5:00')).toHaveClass('fig', 'fig-4')
  })
})
