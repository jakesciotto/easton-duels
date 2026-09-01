import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Textarea } from '@/components/ui/textarea'

describe('Textarea', () => {
  it('renders a labelled textbox and reports typed text', async () => {
    const onChange = vi.fn()
    render(<Textarea aria-label="Roster text" onChange={onChange} />)
    const field = screen.getByRole('textbox', { name: 'Roster text' })
    expect(field.tagName).toBe('TEXTAREA')
    await userEvent.setup().type(field, 'Mateo Rivera, 8, 62, grey, M')
    expect(onChange).toHaveBeenCalled()
    expect(field).toHaveValue('Mateo Rivera, 8, 62, grey, M')
  })

  it('is disabled when asked', () => {
    render(<Textarea aria-label="Roster text" disabled />)
    expect(screen.getByRole('textbox', { name: 'Roster text' })).toBeDisabled()
  })
})
