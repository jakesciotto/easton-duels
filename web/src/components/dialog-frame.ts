import { cn } from '@/lib/utils'

export type DialogWidth = 512 | 576 | 640 | 672

// Tailwind reads class names as literal source text, so the widths are a map of whole
// class strings rather than a template.
const WIDTH: Record<DialogWidth, string> = {
  512: 'sm:max-w-[512px]',
  576: 'sm:max-w-[576px]',
  640: 'sm:max-w-[640px]',
  672: 'sm:max-w-[672px]',
}

/**
 * 6.18. Below 640px a dialog is full screen, radius 0, with the footer band pinned to
 * the bottom safe area. The fixed 512 / 576 / 640 / 672px widths apply at 640px and
 * above only, because a fixed 640px dialog on a 393px viewport is a broken screen and
 * the organizer opens these on a phone at the desk.
 *
 * The list is written mobile first and restores the centred overlay under `sm:` on
 * purpose. `DialogContent` positions and rounds the surface in its own base classes,
 * and tailwind-merge only drops an earlier class when a later one carries the same
 * modifier; a `max-sm:` override would leave both in the sheet and let source order
 * decide. An unprefixed override removes the base class outright, and the `sm:` half
 * then wins inside its media query the same way the primitive's own `sm:max-w-md`
 * already does.
 */
export function dialogSurface(width: DialogWidth): string {
  return cn(
    'top-0 right-0 bottom-0 left-0 h-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] rounded-none border-0',
    'sm:top-1/2 sm:right-auto sm:bottom-auto sm:left-1/2 sm:h-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border',
    WIDTH[width],
  )
}

/** A form that wraps head, body and footer has to span all three rows itself. */
export const dialogStack = 'row-span-3 grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]'

/** Full screen means the body takes the leftover row rather than a viewport fraction. */
export const dialogBody = 'min-h-0 max-h-none sm:max-h-[calc(100dvh-10rem)]'

/**
 * env() resolves to 0 where there is no inset, so one class covers both cases. The band
 * squares off with the surface below 640px, or its 12px corners cut two arcs of the card
 * out of a full screen sheet.
 */
export const dialogFooter = 'rounded-none pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:rounded-b-xl sm:pb-3.5'
