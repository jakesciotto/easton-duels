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
})
