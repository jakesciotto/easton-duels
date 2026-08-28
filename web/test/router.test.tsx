import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '@/router'

describe('router', () => {
  it('renders the admin page at /admin and redirects / to it', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin')
  })
})
