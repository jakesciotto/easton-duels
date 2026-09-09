import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type ApiOptions } from './api'
import { clearAdminToken, getAdminToken } from './auth'
import { useHeldWhileEngaged } from './operatorEngaged'
import type { EventDetail, EventSummary } from './types'

export const qk = {
  events: ['events'] as const,
  event: (id: number) => ['event', id] as const,
}

// Admin request: injects the token; a 401 clears it so PinGate asks again. Certify,
// unlock and delete re-check the PIN and answer 401 bad_pin with the session still good,
// so that one code keeps the token and the dialog that asked.
export async function adminApi<T = unknown>(path: string, opts: Omit<ApiOptions, 'token'> = {}): Promise<T> {
  try {
    return await api<T>(path, { ...opts, token: getAdminToken() })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && e.code !== 'bad_pin') clearAdminToken()
    throw e
  }
}

export function useEvents() {
  return useQuery({ queryKey: qk.events, queryFn: () => adminApi<EventSummary[]>('/api/events') })
}

export interface EventDetailQuery {
  data: EventDetail | undefined
  error: Error | null
  isLoading: boolean
}

/**
 * The event detail is everything the operator EDITS: which matches exist, who is in them,
 * their mat, ruleset, length and order, and every roster cell. react-query invalidates it
 * on every mutation success and refetches it on every window focus, so without 4.4's
 * suspension a reorder resolving mid drag re-indexed the list the gesture was pointing at
 * and a refetch unmounted a roster cell with a typed value still in it.
 *
 * Held by the same mechanism the snapshot poll uses, so the two paths cannot drift apart.
 */
export function useEventDetail(eventId: number): EventDetailQuery {
  const q = useQuery({ queryKey: qk.event(eventId), queryFn: () => adminApi<EventDetail>(`/api/events/${eventId}`) })
  return { data: useHeldWhileEngaged(q.data, eventId), error: q.error, isLoading: q.isLoading }
}

export interface AdminMutationOptions {
  /**
   * Whether the write is finished only once the event has been refetched. It is, for
   * every screen that reports the write by showing the refreshed row, which is all of
   * them but one.
   *
   * The Entry tab is the exception, and it has to be: it confirms in words from the
   * POST's own response and it holds a timeout over the round trip, so counting the
   * refetch as part of the write put a GET inside a deadline written for a POST and a
   * slow success was reported to the desk as a network failure. Passing false hands the
   * caller its result the moment the POST lands; the refetch still runs, just behind it.
   */
  awaitRefetch?: boolean
}

// One mutation helper for every admin write: runs the request, then refetches the event and the list.
export function useAdminMutation<TVars, TResult = unknown>(
  eventId: number | null,
  run: (vars: TVars) => Promise<TResult>,
  opts: AdminMutationOptions = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      const refetched = Promise.all([
        qc.invalidateQueries({ queryKey: qk.events }),
        eventId !== null ? qc.invalidateQueries({ queryKey: qk.event(eventId) }) : Promise.resolve(),
      ])
      return opts.awaitRefetch === false ? undefined : refetched
    },
  })
}
