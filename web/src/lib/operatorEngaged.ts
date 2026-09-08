import { useEffect, useState } from 'react'

// 4.4: an arriving snapshot must not replace state under a drag, an open dialog, or a
// focused input mid gesture. `data-dragging` is the contract a polled surface's drag
// interaction sets on its own root while a drag is in progress; RosterTab and MatchesTab
// both wire it, and useHeldWhileEngaged below is the one mechanism that reads it.
export function operatorEngaged(): boolean {
  if (typeof document === 'undefined') return false

  const dragging = document.querySelector('[data-dragging]')
  if (dragging && dragging.getAttribute('data-dragging') !== 'false') return true

  const active = document.activeElement
  if (active && active !== document.body && active !== granted) {
    const tag = active.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true
    if ((active as HTMLElement).isContentEditable) return true
    // The app's own Select is a button trigger, not a native <select>, so it needs its
    // own check: a focused trigger means the operator is about to open or is navigating it.
    if ((active as HTMLElement).closest('[data-slot="select-trigger"]')) return true
  }

  // Any open dialog, and any open listbox (the popup a Select trigger opens), counts as
  // engaged: an arriving snapshot must not rewrite the options under an open list.
  //
  // Only an OPEN one. A closed base-ui popup stays in the portal carrying `data-closed`,
  // with `hidden` on its positioner, so the bare `[role="listbox"]` this used to match
  // went on matching for the life of the page: one pick from one Select left the whole
  // screen permanently engaged, and 4.4's hold, which is meant to end on close, never
  // released again.
  //
  // One exception, and it has to be asked for by name. A dialog whose CONTENT IS the live
  // state cannot be held: holding it shows the operator a stale reading and lets them commit
  // against it. The scorer's confirm sheet is that case, and it carries its own check that
  // refuses the commit and makes the operator read the new result. Every other dialog is
  // held, because everywhere else an arriving poll is an interruption rather than the point.
  const dialogs = document.querySelectorAll('[data-slot="dialog-content"][data-open], [role="dialog"], [role="listbox"]')
  for (const dialog of dialogs) {
    if (dialog.hasAttribute('data-poll-through')) continue
    if (dialog.closest('[data-closed], [hidden]')) continue
    return true
  }

  return false
}

/**
 * The one field the app itself put the cursor in, which is not an operator gesture.
 *
 * 6.6 ends every save by parking focus on field one for the next entry. Counted as
 * engagement, that focus held the refetch carrying the row the operator had just saved,
 * so the ledger row and the running team score -- the whole confirmation the save
 * exists to produce -- never landed while the desk stayed on the form.
 *
 * The grant covers exactly the element the app focused and ends at the operator's first
 * touch of it, so 4.4's guarantee is untouched: nothing arrives under a real gesture.
 */
let granted: Element | null = null

const GRANT_ENDERS = ['keydown', 'pointerdown', 'blur'] as const

function releaseGrant(): void {
  if (!granted) return
  for (const type of GRANT_ENDERS) granted.removeEventListener(type, releaseGrant)
  granted = null
}

export function focusWithoutEngaging(el: HTMLElement | null | undefined): void {
  releaseGrant()
  if (!el) return
  el.focus()
  if (document.activeElement !== el) return
  granted = el
  for (const type of GRANT_ENDERS) el.addEventListener(type, releaseGrant)
}

// How often a held value rechecks whether the operator has let go. Engagement ends on a
// drop, a blur or a close, none of which is an event this module can subscribe to across
// every surface, so the hold polls its own release.
export const ENGAGEMENT_RECHECK_MS = 200

/**
 * 4.4's held commit, and the only implementation of it.
 *
 * Two independent data paths feed the console: the versioned snapshot poll and the event
 * detail query, which react-query refetches on every mutation success and every window
 * focus. Both replace the operator's screen wholesale, so both need the same suspension --
 * and when the suspension lived in only one of them, a refetch arriving mid drag re-indexed
 * the list the gesture was pointing at and the drop wrote an order nobody chose.
 *
 * `incoming` is returned unchanged while the operator is free. While they are engaged the
 * newest arrival is held and the previous value keeps rendering; the hold releases on the
 * first recheck that finds them free, and only the most recent arrival is kept.
 *
 * `resetKey` is the identity of the thing being watched (an event id). A held value is only
 * ever the same subject's older self, so a change of key commits at once rather than leaving
 * one event's data on screen under another event's page.
 */
export function useHeldWhileEngaged<T>(incoming: T, resetKey?: unknown): T {
  const [committed, setCommitted] = useState(incoming)
  const [watching, setWatching] = useState(resetKey)

  // Two commits happen during render, and in both there is nothing on screen to protect:
  // a change of subject, and the first arrival. Holding the first arrival would keep a
  // route on its loading state for as long as a field stayed focused, and routing it
  // through an effect instead would put the first paint of every screen a frame late.
  // React re-renders in the same pass, so neither costs a frame.
  if (watching !== resetKey) {
    setWatching(resetKey)
    setCommitted(incoming)
  } else if (incoming !== committed && (committed === null || committed === undefined)) {
    setCommitted(incoming)
  }

  useEffect(() => {
    if (incoming === committed) return
    if (!operatorEngaged()) {
      setCommitted(incoming)
      return
    }
    // The effect re-runs on every new arrival, so this closure always holds the newest one.
    const timer = setInterval(() => {
      if (operatorEngaged()) return
      clearInterval(timer)
      setCommitted(incoming)
    }, ENGAGEMENT_RECHECK_MS)
    return () => clearInterval(timer)
  }, [incoming, committed])

  return committed
}
