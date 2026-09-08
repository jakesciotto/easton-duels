/**
 * The three step setup lives in the URL rather than in a page state, so a reload on the
 * gym wifi resumes the step the organizer was on instead of dropping them on a bare event
 * with no roster. An event opened from the list carries no param and sees no step.
 */
export const SETUP_PARAM = 'setup'

export const SETUP_STEPS = ['roster', 'matches'] as const

export type SetupStep = (typeof SETUP_STEPS)[number]

export function setupStepOf(value: string | null): SetupStep | null {
  return SETUP_STEPS.includes(value as SetupStep) ? (value as SetupStep) : null
}

export function eventSetupPath(eventId: number, step: SetupStep): string {
  return `/events/${eventId}?${SETUP_PARAM}=${step}`
}
