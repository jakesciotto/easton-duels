import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TEAM_COLOR_KEYS } from '@shared/types'
import { ColourOrbs } from '@/components/ColourOrb'

describe('ColourOrbs', () => {
  it('renders one radio per team colour and checks the selected one', () => {
    render(<ColourOrbs value="red" onChange={() => {}} aria-label="Team A colour" />)
    expect(screen.getByRole('radiogroup', { name: 'Team A colour' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(TEAM_COLOR_KEYS.length)
    expect(screen.getAllByRole('radio')).toHaveLength(8)
    expect(screen.getByRole('radio', { name: 'Red' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Blue' })).not.toBeChecked()
  })

  it('calls onChange with the key of the clicked colour', async () => {
    const onChange = vi.fn()
    render(<ColourOrbs value="red" onChange={onChange} aria-label="Team B colour" />)
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Teal' }))
    expect(onChange).toHaveBeenCalledWith('teal')
  })
})
