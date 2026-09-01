// 4.4: an arriving snapshot must not replace state under a drag, an open dialog, or a
// focused input mid gesture. `data-dragging` is the contract a polled surface's drag
// interaction sets on its own root while a drag is in progress. No polled tab wires that
// attribute yet (RosterTab and MatchesTab still own that work), but the mechanism is kept
// because 4.4 and 7.2 both require it and useSnapshot already tests the contract.
export function operatorEngaged(): boolean {
  if (typeof document === 'undefined') return false

  const dragging = document.querySelector('[data-dragging]')
  if (dragging && dragging.getAttribute('data-dragging') !== 'false') return true

  const active = document.activeElement
  if (active && active !== document.body) {
    const tag = active.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true
    if ((active as HTMLElement).isContentEditable) return true
    // The app's own Select is a button trigger, not a native <select>, so it needs its
    // own check: a focused trigger means the operator is about to open or is navigating it.
    if ((active as HTMLElement).closest('[data-slot="select-trigger"]')) return true
  }

  // Any open dialog, and any open listbox (the popup a Select trigger opens), counts as
  // engaged: an arriving snapshot must not rewrite the options under an open list.
  if (document.querySelector('[data-slot="dialog-content"][data-open], [role="dialog"], [role="listbox"]')) return true

  return false
}
