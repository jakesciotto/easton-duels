import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeField } from '@/components/CodeField'

describe('CodeField', () => {
  it('renders one well per character', () => {
    render(
      <>
        <label htmlFor="mat-code">Mat code</label>
        <CodeField id="mat-code" length={4} aria-label="Mat code" />
      </>,
    )
    expect(screen.getAllByRole('textbox')).toHaveLength(4)
  })

  it('reports the value as each well fills, and completion once full', async () => {
    const onValueChange = vi.fn()
    const onValueComplete = vi.fn()
    render(
      <CodeField length={4} aria-label="Mat code" onValueChange={onValueChange} onValueComplete={onValueComplete} />,
    )
    const wells = screen.getAllByRole('textbox')
    const user = userEvent.setup()
    await user.type(wells[0], '4')
    await user.type(wells[1], '8')
    await user.type(wells[2], '2')
    await user.type(wells[3], '1')
    expect(onValueChange).toHaveBeenCalledWith('4821')
    expect(onValueComplete).toHaveBeenCalledWith('4821')
  })

  it('rejects a non digit', async () => {
    const onValueChange = vi.fn()
    render(<CodeField length={4} aria-label="Mat code" onValueChange={onValueChange} />)
    await userEvent.setup().type(screen.getAllByRole('textbox')[0], 'a')
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('is disabled when asked', () => {
    render(<CodeField length={4} aria-label="Mat code" disabled />)
    for (const well of screen.getAllByRole('textbox')) expect(well).toBeDisabled()
  })
})
