import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TeamColor } from '@shared/types'
import { TeamList, type TeamDraft } from '@/routes/event/TeamList'

const draft = (name: string, color: TeamColor, id?: number): TeamDraft => ({ id, name, color })

function mount(teams: TeamDraft[], over: Partial<Parameters<typeof TeamList>[0]> = {}) {
  const onAdd = vi.fn()
  const onRemove = vi.fn()
  const onChange = vi.fn()
  const view = render(<TeamList teams={teams} onAdd={onAdd} onRemove={onRemove} onChange={onChange} {...over} />)
  return { onAdd, onRemove, onChange, view }
}

const grid = (name: string) => screen.getByRole('radiogroup', { name })

describe('TeamList', () => {
  it('names each row by its place and edits the name in it', async () => {
    const { onChange } = mount([draft('Ridgeline', 'red'), draft('Lakeside', 'blue')])
    const user = userEvent.setup()
    expect(screen.getByLabelText('Team 1 name')).toHaveValue('Ridgeline')
    expect(screen.getByLabelText('Team 2 name')).toHaveValue('Lakeside')
    await user.type(screen.getByLabelText('Team 2 name'), 'x')
    expect(onChange).toHaveBeenCalledWith(1, { id: undefined, name: 'Lakesidex', color: 'blue' })
  })

  // 2.4's guards run against every other team on the event, not just one of them.
  it('keeps a colour another team holds off the grid entirely', () => {
    mount([draft('Ridgeline', 'red'), draft('Lakeside', 'blue'), draft('Fernwood', 'teal')])
    const third = grid('Team 3 colour')
    expect(within(third).queryByRole('radio', { name: 'Azure' })).not.toBeInTheDocument()
    expect(within(third).queryByRole('radio', { name: 'Crimson' })).not.toBeInTheDocument()
    expect(within(third).getByRole('radio', { name: 'Teal' })).toBeInTheDocument()
  })

  it('refuses the partners that read as the team already chosen', () => {
    mount([draft('Ridgeline', 'red'), draft('Lakeside', 'blue')])
    const second = grid('Team 2 colour')
    for (const name of ['Amber', 'Magenta', 'Citron', 'Green']) {
      expect(within(second).getByRole('radio', { name }), name).toHaveAttribute('aria-disabled', 'true')
    }
    for (const name of ['Teal', 'Violet']) {
      expect(within(second).getByRole('radio', { name }), name).not.toHaveAttribute('aria-disabled')
    }
  })

  // Eight hues 45 degrees apart cannot all clear a 60 degree floor, so a third team often
  // has no legal colour left. Refusing them all would stop the organizer from building the
  // event the product allows, so the guard states the problem instead.
  it('stops refusing once refusing would leave nothing to pick', () => {
    mount([draft('Ridgeline', 'red'), draft('Lakeside', 'blue'), draft('Fernwood', 'green')])
    const third = grid('Team 3 colour')
    expect(within(third).getAllByRole('radio').filter(r => r.hasAttribute('aria-disabled'))).toHaveLength(0)
    // The sentence states the problem and stops: there is nothing left to suggest.
    const note = third.parentElement!.querySelector('p')
    expect(note?.textContent).toMatch(/look the same|one person in twelve|close under colour blindness/)
    expect(note?.textContent).not.toContain('Try')
  })

  it('names the conflict rather than silently refusing', async () => {
    const { onChange } = mount([draft('Ridgeline', 'red'), draft('Lakeside', 'blue')])
    const user = userEvent.setup()
    await user.click(within(grid('Team 2 colour')).getByRole('radio', { name: 'Amber' }))
    expect(screen.getByText(/look the same from the back of the gym/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('adds a team through one draft row, on a colour nobody holds', async () => {
    const { onAdd } = mount([draft('Ridgeline', 'red'), draft('Lakeside', 'blue')])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add a team' }))
    await user.type(screen.getByLabelText('New team name'), 'Fernwood')
    await user.click(screen.getByRole('button', { name: 'Add team' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    const added = onAdd.mock.calls[0][0] as TeamDraft
    expect(added.name).toBe('Fernwood')
    expect(['red', 'blue']).not.toContain(added.color)
  })

  it('will not add a team with no name', async () => {
    mount([draft('Ridgeline', 'red'), draft('Lakeside', 'blue')])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add a team' }))
    expect(screen.getByRole('button', { name: 'Add team' })).toBeDisabled()
  })

  it('stops at eight teams and says so', () => {
    const colors: TeamColor[] = ['red', 'blue', 'green', 'amber', 'purple', 'pink', 'teal', 'orange']
    mount(colors.map((c, i) => draft(`Team ${i + 1}`, c)))
    expect(screen.queryByRole('button', { name: 'Add a team' })).not.toBeInTheDocument()
    expect(screen.getByText('An event holds at most eight teams.')).toBeInTheDocument()
  })

  it('removes a team above two', async () => {
    const { onRemove } = mount([draft('Ridgeline', 'red'), draft('Lakeside', 'blue'), draft('Fernwood', 'teal')])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove Fernwood' }))
    expect(onRemove).toHaveBeenCalledWith(2)
  })

  it('refuses to go below two, with the reason on the control', () => {
    mount([draft('Ridgeline', 'red'), draft('Lakeside', 'blue')])
    const remove = screen.getByRole('button', { name: 'Remove Lakeside' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('title', 'An event holds at least two teams.')
  })

  // After creation the rows are rows on the server: they are added and removed, never
  // retyped in place, so the list shows what is there rather than a form over it.
  it('locks the rows it did not create, keeping Remove alive', () => {
    mount([draft('Ridgeline', 'red', 1), draft('Lakeside', 'blue', 2), draft('Fernwood', 'teal', 3)], { locked: true })
    expect(screen.queryByLabelText('Team 1 name')).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Team 1 colour' })).not.toBeInTheDocument()
    expect(screen.getByText('Ridgeline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Fernwood' })).toBeEnabled()
  })

  it('prints the error its caller hands it', () => {
    mount([draft('Ridgeline', 'red', 1), draft('Lakeside', 'blue', 2)], { locked: true, error: 'a team with competitors on it cannot be removed' })
    expect(screen.getByRole('alert')).toHaveTextContent('a team with competitors on it cannot be removed')
  })

  it('drops the draft row once the team it made has landed', async () => {
    const teams = [draft('Ridgeline', 'red'), draft('Lakeside', 'blue')]
    const { view } = mount(teams)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add a team' }))
    await user.type(screen.getByLabelText('New team name'), 'Fernwood')
    view.rerender(<TeamList teams={[...teams, draft('Fernwood', 'teal')]} onAdd={() => {}} onRemove={() => {}} onChange={() => {}} />)
    expect(screen.queryByLabelText('New team name')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Team 3 name')).toHaveValue('Fernwood')
  })
})
