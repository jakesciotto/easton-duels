import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

function Sample({ density }: { density?: 'compact' | 'default' }) {
  return (
    <Table density={density} aria-label="Sample table">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead numeric>Age</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow selected>
          <TableCell>Mateo Rivera</TableCell>
          <TableCell numeric>8</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Olivia Kim</TableCell>
          <TableCell numeric>9</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

describe('Table', () => {
  it('renders a real table with the given rows and columns', () => {
    render(<Sample />)
    expect(screen.getByRole('table', { name: 'Sample table' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('cell', { name: 'Mateo Rivera' })).toBeInTheDocument()
  })

  it('marks the selected row so it can be styled', () => {
    render(<Sample />)
    const selectedRow = screen.getByRole('cell', { name: 'Mateo Rivera' }).closest('tr')
    expect(selectedRow).toHaveAttribute('data-selected', 'true')
    const otherRow = screen.getByRole('cell', { name: 'Olivia Kim' }).closest('tr')
    expect(otherRow).not.toHaveAttribute('data-selected')
  })

  it('defaults to the compact density and switches on request', () => {
    const { rerender } = render(<Sample />)
    expect(screen.getByRole('table')).toHaveAttribute('data-density', 'compact')
    rerender(<Sample density="default" />)
    expect(screen.getByRole('table')).toHaveAttribute('data-density', 'default')
  })

  // Finding 3: `ch` (and so var(--col-num-*)) resolves against each element's OWN
  // font-size. A numeric head left at the general t1 column-head step while its body
  // cell renders at t2 makes the two ends of one declared track resolve to different
  // pixel widths, so the browser gives the column whichever is larger and the register
  // tick strands off the digits it is supposed to mark.
  it('pins a numeric head to the body cell\'s own type step instead of the general column-head size', () => {
    render(<Sample />)
    const head = screen.getByRole('columnheader', { name: 'Age' })
    expect(head.className).toMatch(/(^|\s)t2(\s|$)/)
    expect(head.className).not.toMatch(/(^|\s)t1(\s|$)/)
  })

  // Finding 4: overflow-x-auto alone still computes overflow-y to auto (CSS promotes a
  // visible axis when the other is not visible), so this div is already a scroll
  // container on both axes. A caller that wraps <Table> in its own vertically
  // scrolling div therefore nests two scroll containers, and the sticky head sticks to
  // the inner, unconstrained one instead of the one that actually scrolls.
  // wrapperClassName lets a caller fold its scroll box into this single div.
  it('folds a caller-provided wrapper class onto its own scrollport instead of requiring a second one', () => {
    render(
      <Table wrapperClassName="max-h-56 overflow-y-auto" aria-label="Wrapped">
        <TableBody>
          <TableRow><TableCell>Row</TableCell></TableRow>
        </TableBody>
      </Table>
    )
    const wrapper = screen.getByRole('table', { name: 'Wrapped' }).parentElement as HTMLElement
    expect(wrapper.className).toMatch(/overflow-x-auto/)
    expect(wrapper.className).toMatch(/overflow-y-auto/)
  })
})
