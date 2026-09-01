import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'

describe('Alert', () => {
  it('renders as an alert role with heading and body text', () => {
    render(
      <Alert>
        <AlertTitle>Could not reach the server</AlertTitle>
        <AlertDescription>Your entry is saved on this device and will send when the connection returns.</AlertDescription>
      </Alert>,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not reach the server')
    expect(alert).toHaveTextContent('Your entry is saved on this device')
  })

  it('carries the attend variant on the title when asked', () => {
    render(
      <Alert variant="attend">
        <AlertTitle variant="attend">Referee decision required</AlertTitle>
      </Alert>,
    )
    expect(screen.getByText('Referee decision required')).toHaveClass('text-attend')
  })

  it('defaults to the fault variant', () => {
    render(
      <Alert>
        <AlertTitle>This match already ended</AlertTitle>
      </Alert>,
    )
    expect(screen.getByText('This match already ended')).toHaveClass('text-fault')
  })
})
