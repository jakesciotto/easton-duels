import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

// Pointer events, not HTML5 drag events, because dragstart never fires on touch and
// the organizer runs this screen on a tablet.
const THRESHOLD = 8

export const DROP_ATTR = 'data-drop-team'
export const UNASSIGNED = 'none'

export function dropZoneValue(teamId: number | null): string {
  return teamId === null ? UNASSIGNED : String(teamId)
}

function zoneAt(x: number, y: number): string | null {
  // jsdom has no elementFromPoint, and neither does a headless snapshot render.
  const at = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
  return at?.closest(`[${DROP_ATTR}]`)?.getAttribute(DROP_ATTR) ?? null
}

export function useRosterDrag(onDrop: (athleteId: number, teamId: number | null) => void) {
  const [dragging, setDragging] = useState(false)
  const [over, setOver] = useState<string | null>(null)
  const press = useRef<{ id: number; x: number; y: number; touch: boolean } | null>(null)
  const active = useRef(false)
  const overRef = useRef<string | null>(null)
  const drop = useRef(onDrop)
  drop.current = onDrop

  const reset = useCallback(() => {
    press.current = null
    active.current = false
    overRef.current = null
    setDragging(false)
    setOver(null)
  }, [])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current
      if (!p) return
      if (!active.current) {
        const dx = Math.abs(e.clientX - p.x)
        const dy = Math.abs(e.clientY - p.y)
        // A touch that travels mostly downward is the organizer scrolling the list,
        // so only a sideways intent picks a competitor up.
        if (dx < THRESHOLD || (p.touch && dx < dy)) return
        active.current = true
        setDragging(true)
      }
      const zone = zoneAt(e.clientX, e.clientY)
      if (zone === overRef.current) return
      overRef.current = zone
      setOver(zone)
    }
    const up = (e: PointerEvent) => {
      const p = press.current
      const wasActive = active.current
      const zone = wasActive ? zoneAt(e.clientX, e.clientY) ?? overRef.current : null
      reset()
      if (p && wasActive && zone !== null) drop.current(p.id, zone === UNASSIGNED ? null : Number(zone))
    }
    const cancel = () => reset()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [reset])

  const start = useCallback((e: ReactPointerEvent, id: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    press.current = { id, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' }
  }, [])

  return { dragging, over, start }
}
