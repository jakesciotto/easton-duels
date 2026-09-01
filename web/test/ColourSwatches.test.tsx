import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TEAM_COLOR_KEYS } from '@shared/types'
import { ColourSwatches } from '@/components/ColourSwatches'

describe('ColourSwatches', () => {
  it('renders one radio per team colour and checks the selected one', () => {
    render(<ColourSwatches value="red" onChange={() => {}} aria-label="Team A colour" />)
    expect(screen.getByRole('radiogroup', { name: 'Team A colour' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(TEAM_COLOR_KEYS.length)
    expect(screen.getAllByRole('radio')).toHaveLength(8)
    expect(screen.getByRole('radio', { name: 'Crimson' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Azure' })).not.toBeChecked()
  })

  it('labels every swatch with the colour a person sees, not the stored key', () => {
    render(<ColourSwatches value="red" onChange={() => {}} aria-label="Team A colour" />)
    // Eight evenly spread hues leave room for only two warm ones, so the keys
    // "green" and "amber" can no longer match their own hue. The stored key is
    // frozen for data compatibility and the label is what the organizer reads.
    expect(screen.getByRole('radio', { name: 'Citron' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Green' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Red' })).not.toBeInTheDocument()
  })

  it('calls onChange with the key of the clicked colour', async () => {
    const onChange = vi.fn()
    render(<ColourSwatches value="red" onChange={onChange} aria-label="Team B colour" />)
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Teal' }))
    expect(onChange).toHaveBeenCalledWith('teal')
  })
})
