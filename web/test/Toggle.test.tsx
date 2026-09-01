import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toggle } from '@/components/ui/toggle'

describe('Toggle', () => {
  it('renders an unpressed button by default', () => {
    render(<Toggle aria-label="Ridgeline wins">Ridgeline</Toggle>)
    expect(screen.getByRole('button', { name: 'Ridgeline wins' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('flips pressed state on click and reports it', async () => {
    const onPressedChange = vi.fn()
    render(<Toggle aria-label="Ridgeline wins" onPressedChange={onPressedChange}>Ridgeline</Toggle>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ridgeline wins' }))
    expect(onPressedChange).toHaveBeenCalledWith(true, expect.anything())
    expect(screen.getByRole('button', { name: 'Ridgeline wins' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('supports a controlled pressed value', () => {
    render(<Toggle aria-label="Ridgeline wins" pressed>Ridgeline</Toggle>)
    expect(screen.getByRole('button', { name: 'Ridgeline wins' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('is disabled when asked', () => {
    render(<Toggle aria-label="Ridgeline wins" disabled>Ridgeline</Toggle>)
    expect(screen.getByRole('button', { name: 'Ridgeline wins' })).toBeDisabled()
  })
})
