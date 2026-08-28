import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Segment } from '@/components/ui/segment'

const options = [
  { value: 'points', label: 'Points' },
  { value: 'submission', label: 'Submission' },
  { value: 'decision', label: 'Decision' },
]

describe('Segment', () => {
  it('renders one radio per option and checks the active one', () => {
    render(<Segment value="points" onValueChange={() => {}} options={options} aria-label="Win type" />)
    expect(screen.getByRole('radiogroup', { name: 'Win type' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Points' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Decision' })).not.toBeChecked()
  })

  it('reports the new value on click', async () => {
    const onValueChange = vi.fn()
    render(<Segment value="points" onValueChange={onValueChange} options={options} aria-label="Win type" />)
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Submission' }))
    expect(onValueChange).toHaveBeenCalledWith('submission')
  })

  it('reports the new value on an arrow key', async () => {
    const onValueChange = vi.fn()
    render(<Segment value="points" onValueChange={onValueChange} options={options} aria-label="Win type" />)
    const user = userEvent.setup()
    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(onValueChange).toHaveBeenCalledWith('submission')
  })
})
