// 4.4: an arriving snapshot must not replace state under a drag, an open dialog, or a
// focused input mid gesture. `data-dragging` is the contract a polled surface's drag
// interaction sets on its own root while a drag is in progress.
export function operatorEngaged(): boolean {
  if (typeof document === 'undefined') return false

  const dragging = document.querySelector('[data-dragging]')
  if (dragging && dragging.getAttribute('data-dragging') !== 'false') return true

  const active = document.activeElement
  if (active && active !== document.body) {
    const tag = active.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true
    if ((active as HTMLElement).isContentEditable) return true
  }

  if (document.querySelector('[data-slot="dialog-content"][data-open], [role="dialog"]')) return true

  return false
}
