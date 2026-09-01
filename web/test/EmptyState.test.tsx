import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

describe('EmptyState', () => {
  it('renders the message and an inline action in one row', async () => {
    const onAction = vi.fn()
    render(
      <EmptyState
        message="No competitors here yet."
        action={<Button variant="ghost" size="sm" onClick={onAction}>Add competitor</Button>}
      />,
    )
    expect(screen.getByText('No competitors here yet.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add competitor' }))
    expect(onAction).toHaveBeenCalled()
  })

  it('renders without an action when none is given', () => {
    render(<EmptyState message="No matches yet." />)
    expect(screen.getByText('No matches yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
