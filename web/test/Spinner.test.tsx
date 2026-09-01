import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Spinner } from '@/components/ui/spinner'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('Spinner', () => {
  it('does not render immediately, then appears once the show delay elapses', async () => {
    render(<Spinner show />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument(), { timeout: 1000 })
  })

  it('stays visible for a minimum time even if show clears immediately', async () => {
    const { rerender } = render(<Spinner show />)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument(), { timeout: 1000 })
    rerender(<Spinner show={false} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    await wait(200)
    expect(screen.getByRole('status')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), { timeout: 1000 })
  })

  it('never appears if show clears before the show delay elapses', async () => {
    const { rerender } = render(<Spinner show />)
    await wait(50)
    rerender(<Spinner show={false} />)
    await wait(400)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
