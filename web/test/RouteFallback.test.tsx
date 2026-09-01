import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouteFallback } from '@/components/RouteFallback'

describe('RouteFallback', () => {
  it('announces loading to assistive tech without a visible Loading word', () => {
    const { container } = render(<RouteFallback />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading')
    // The skeleton scaffolding standing in for content is hidden from assistive tech --
    // only the sr-only announcement above it should be exposed.
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument()
  })

  it('sizes its rows to the requested rung', () => {
    const { container } = render(<RouteFallback rung="two-line" rows={3} />)
    const rows = container.querySelectorAll('.border-t.border-gray-7')
    expect(rows).toHaveLength(3)
    for (const row of rows) expect((row as HTMLElement).style.height).toBe('56px')
  })

  it('omits the tab rail skeleton when told there are no tabs', () => {
    const { container: withTabs } = render(<RouteFallback tabs rows={0} />)
    const { container: withoutTabs } = render(<RouteFallback tabs={false} rows={0} />)
    expect(withTabs.querySelectorAll('[data-slot="skeleton"]').length)
      .toBeGreaterThan(withoutTabs.querySelectorAll('[data-slot="skeleton"]').length)
  })
})
