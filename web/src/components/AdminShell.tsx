import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { clearAdminToken } from '@/lib/auth'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { useNow } from '@/lib/useClock'
import { ageSeconds, formatAge, headerFreshnessLevel } from '@/lib/freshness'
import { cn } from '@/lib/utils'

// What the shell needs to drive the freshness readout (6.4): the same lastSuccessAt a
// caller's useSnapshot() already exposes, and the poll interval it is actually using --
// pass pollIntervalForSnapshot(snapshot) unless the caller pinned an explicit one.
//
// `freshness` is optional and, as of this writing, no caller passes it: EventPage (6.4's
// own shell) reads its event through useEventDetail, a one-shot react-query fetch with no
// lastSuccessAt, while the live snapshot 6.4 wants to report on is polled separately inside
// event/LiveTab. Wiring that through means lifting the poll out of LiveTab and into
// EventPage, which is out of this file's scope. Until that lands, the honest behaviour is
// the one below: no freshness prop means no status region, never a region claiming
// freshness it does not have. Do not default this to a fake "Live" state.
export interface ShellFreshness {
  lastSuccessAt: number | null
  pollIntervalMs: number
}

function FreshnessSlot({ freshness }: { freshness: ShellFreshness }) {
  const now = useNow(freshness.lastSuccessAt !== null, 1000)
  const ageSec = ageSeconds(freshness.lastSuccessAt, now)

  if (ageSec === null) {
    return (
      <span className="ml-auto flex shrink-0 items-center gap-2 t2 text-gray-10">
        <span aria-hidden className="size-1.5 rounded-full bg-gray-8" />
        Connecting
      </span>
    )
  }

  const level = headerFreshnessLevel(ageSec)
  const tone = level === 'fault' ? 'text-fault' : level === 'attend' ? 'text-attend' : 'text-gray-11'
  const dot = level === 'fault' ? 'bg-fault' : level === 'attend' ? 'bg-attend' : 'bg-gray-11'

  return (
    // Changes every second by design; a live region here would be a speech denial of
    // service (7.12), so it is read on demand rather than announced.
    <span aria-live="off" className={cn('ml-auto flex shrink-0 items-center gap-2 t2', tone)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', dot)} />
      Live <span className="fig fig-2">{formatAge(ageSec)}</span>
    </span>
  )
}

export function AdminShell({ title, status, actions, meta, freshness, children }: {
  title: string
  status?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  freshness?: ShellFreshness
  children: ReactNode
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-gray-7 bg-background py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6">
          <Link to="/admin" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:shadow-focus">
            <img src="/easton-logo.png" alt="Easton Training Center" width={24} height={24} className="size-6 shrink-0 rounded-full" />
            <Wordmark />
          </Link>
          <span aria-hidden className="text-gray-8">/</span>
          <span className="truncate t2 text-gray-12">{title}</span>
          {status}
          {freshness && <FreshnessSlot freshness={freshness} />}
          <div className={cn('flex items-center gap-2', !freshness && 'ml-auto')}>
            {actions}
            <Button variant="ghost" size="sm" onClick={clearAdminToken}>Sign out</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl t3">
        <div className="grid gap-2 px-6 pt-6 pb-4">
          <h1 className="truncate t6 text-gray-12">{title}</h1>
          {meta}
        </div>
        {children}
      </main>
    </div>
  )
}
