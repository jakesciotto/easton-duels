import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Chip } from '@/components/ui/chip'

describe('Chip', () => {
  it('renders a label plus a mono value', () => {
    render(<Chip label="ERP" value="6.1" />)
    expect(screen.getByText('ERP')).toBeInTheDocument()
    expect(screen.getByText('6.1')).toHaveClass('fig')
  })

  it('renders plain children when no label/value pair is given', () => {
    render(<Chip title="belt + age + weight">belt + age + weight</Chip>)
    const chip = screen.getByTitle('belt + age + weight')
    expect(chip).toHaveTextContent('belt + age + weight')
  })
})
