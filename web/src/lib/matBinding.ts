import { ApiError } from './api'

/**
 * Why a tablet lost its mat, and what a volunteer is told to do about it. 7.12: the copy is
 * mapped from the server's own error codes, and it travels to the mat pick page on the URL
 * so a reload does not swallow the reason along with the redirect that carried it.
 */
export type BindLoss = 'expired' | 'taken'

export const BIND_LOSS_COPY: Record<BindLoss, string> = {
  // A token lives 24 hours, so this is the tablet that was bound at the rehearsal and
  // carried to the event a week later.
  expired: 'This iPad needs the mat code again.',
  // The server's own sentence, because it is already written for the person reading it.
  taken: 'Another iPad took this mat over. Bind again to score from here.',
}

export function bindLossOf(e: unknown): BindLoss | null {
  if (!(e instanceof ApiError) || e.status !== 401) return null
  if (e.code === 'token_stale') return 'taken'
  if (e.code === 'unauthorized') return 'expired'
  return null
}

export function isBindLoss(value: string | null): value is BindLoss {
  return value === 'expired' || value === 'taken'
}

/** The mat pick page, carrying the event it should offer and the reason it was sent there. */
export function matPickPath(eventId: number, reason: BindLoss): string {
  return `/mat?event=${eventId}&reason=${reason}`
}
