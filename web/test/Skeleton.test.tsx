import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Skeleton } from '@/components/ui/skeleton'

describe('Skeleton', () => {
  it('renders a decorative block hidden from assistive tech', () => {
    const { container } = render(<Skeleton className="h-9 w-24" />)
    const el = container.querySelector('[data-slot="skeleton"]')
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el).toHaveClass('h-9', 'w-24')
  })
})
