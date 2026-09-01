import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { clearAdminToken } from '@/lib/auth'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { useNow } from '@/lib/useClock'
import { ageSeconds, formatAge, headerFreshnessLevel } from '@/lib/freshness'
import { cn } from '@/lib/utils'

// What the shell needs to drive the freshness readout (6.4): the same lastSuccessAt the
// event's one useSnapshot() stream exposes, and the poll interval it is actually using --
// pass pollIntervalForSnapshot(snapshot) unless the caller pinned an explicit one.
//
// `freshness` stays optional, and absence still means no status region at all rather than
// a region claiming freshness it does not have. Do not default this to a fake "Live" state.
//
// `paused` is the other half of that honesty (4.4 / WCAG 2.2.2). The poll keeps running
// while the operator has stopped the picture, so a header driven by lastSuccessAt alone
// would read "Live 1s" over a screen that has not moved since they pressed the button.
export interface ShellFreshness {
  lastSuccessAt: number | null
  pollIntervalMs: number
  paused?: boolean
  waiting?: number
}

function FreshnessSlot({ freshness }: { freshness: ShellFreshness }) {
  const now = useNow(freshness.lastSuccessAt !== null && !freshness.paused, 1000)
  const ageSec = ageSeconds(freshness.lastSuccessAt, now)

  if (freshness.paused) {
    const waiting = freshness.waiting ?? 0
    return (
      <span aria-live="off" className="ml-auto flex shrink-0 items-center gap-2 t2 text-attend">
        <span aria-hidden className="size-1.5 rounded-full bg-attend" />
        Paused, <span className="fig fig-2">{waiting}</span> {waiting === 1 ? 'update' : 'updates'} waiting
      </span>
    )
  }

  if (ageSec === null) {
    return (
      <span className="ml-auto flex shrink-0 items-center gap-2 t2 text-gray-10">
        <span aria-hidden className="size-1.5 rounded-full bg-gray-8" />
        Connecting
      </span>
    )
  }

  const level = headerFreshnessLevel(ageSec, freshness.pollIntervalMs)
  const tone = level === 'fault' ? 'text-fault' : level === 'attend' ? 'text-attend' : 'text-gray-11'
  const dot = level === 'fault' ? 'bg-fault' : level === 'attend' ? 'bg-attend' : 'bg-gray-11'

  return (
    // The age is printed only once the data stopped arriving. While the app is healthy the
    // age is always under one poll interval, so a number here counts up and resets on every
    // poll: it changes every second and reports nothing the operator can act on. A live
    // region would also be a speech denial of service (7.12), so it is read on demand.
    <span aria-live="off" className={cn('ml-auto flex shrink-0 items-center gap-2 t2', tone)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', dot)} />
      {level === 'fresh'
        ? 'Live'
        : <>Not updating <span className="fig fig-2">{formatAge(ageSec)}</span></>}
    </span>
  )
}

/**
 * The header wraps below 640px, so its height is not a constant any other sticky can
 * assume. It publishes its measured height instead, and an in-page sticky offsets by
 * that. A hardcoded offset and a wrapping header disagree at exactly the width where
 * the subhead would cover the wordmark.
 */
function useHeaderHeight() {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const publish = () => document.documentElement.style.setProperty('--app-header-h', `${el.offsetHeight}px`)
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return ref
}

export function AdminShell({ title, status, actions, meta, freshness, footer, children }: {
  title: string
  status?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  freshness?: ShellFreshness
  // 6.4: "one line: Questions at the desk: [organizer first name], [phone]." An owner-set
  // field on the event drives this; no such field exists on the event row yet (server
  // schema, out of this file's scope), so the band renders only when a caller has one to
  // pass, never a fabricated line.
  footer?: ReactNode
  children: ReactNode
}) {
  const headerRef = useHeaderHeight()
  return (
    <div className="flex min-h-dvh flex-col">
      {/* z-20 keeps the app header above every in-page sticky. A subhead that pins at
          the same level wins on document order and paints over the wordmark. */}
      <header ref={headerRef} className="sticky top-0 z-20 border-b border-gray-7 bg-background py-3">
        {/* 6.18: below 640px the shell is one column with 16px gutters and must not
            introduce horizontal scroll, so the band wraps rather than pushing the page
            sideways. At 640px and above every item fits on one line and nothing wraps. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6">
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
      <main className="mx-auto w-full max-w-6xl flex-1 t3">
        <div className="grid gap-2 px-4 pt-6 pb-4 sm:px-6">
          <h1 className="truncate t6 text-gray-12">{title}</h1>
          {meta}
        </div>
        {children}
      </main>
      {footer && (
        <footer className="sticky bottom-0 z-10 border-t border-gray-7 bg-gray-1 px-4 py-2 t2 text-gray-10 sm:px-6">
          <div className="mx-auto max-w-6xl">{footer}</div>
        </footer>
      )}
    </div>
  )
}
