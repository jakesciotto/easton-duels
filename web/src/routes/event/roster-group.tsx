import type { PointerEvent as ReactPointerEvent } from 'react'
import type { AthleteRow } from '@/lib/types'
import { TeamPlate } from '@/components/TeamPlate'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldHead, FieldSet } from '@/components/ui/field-set'
import { cn } from '@/lib/utils'
import { DROP_ATTR, dropZoneValue } from './roster-drag'
import { ROSTER_COLS, RosterRow } from './roster-row'

/**
 * The app shell's header is sticky at the same stacking level and is painted first, so
 * an in-page sticky that matches it wins on document order and covers the mark, the
 * wordmark and the event name. The subhead therefore sits one level below the header
 * (still above the row content, which is not positioned) and clears the header's own
 * height. That height is declared in `AdminShell`, which this file does not own, so it
 * is read as a custom property and falls back to the shell's measured height: 12px of
 * padding each side of a 32px control row, plus its 1px bottom rule.
 */
const SUBHEAD_STICKY = 'sticky top-[var(--app-header-h,57px)] z-1'

export function RosterGroup({
  title, color, teamId, kids, selected, faults, inMatch, firstGroup, dragging, over,
  onSelect, onPatch, onRemove, onDragStart, onAdd,
}: {
  title: string
  color: string | null
  teamId: number | null
  kids: AthleteRow[]
  selected: Set<number>
  faults: Set<number>
  inMatch: Set<number>
  firstGroup: boolean
  dragging: boolean
  over: boolean
  onSelect: (id: number, v: boolean, range: boolean) => void
  onPatch: (id: number, body: Partial<AthleteRow>) => void
  onRemove: (kid: AthleteRow) => void
  onDragStart: (e: ReactPointerEvent, id: number) => void
  onAdd?: () => void
}) {
  return (
    <section aria-label={title} className="min-w-0" {...{ [DROP_ATTR]: dropZoneValue(teamId) }}>
      {/* Below 1280 the three columns are one field, so the group head pins itself
          as a subhead over the ground rather than sitting beside its neighbours. */}
      <div className={cn(SUBHEAD_STICKY, 'flex h-10 items-center gap-3 bg-background xl:static xl:h-8 xl:bg-transparent')}>
        {color
          ? <TeamPlate color={color} name={title} />
          : <span className="t2 font-medium! text-gray-11">{title}</span>}
        <span className="ml-auto fig t2 text-gray-10">{kids.length}</span>
      </div>
      <FieldSet
        className={cn(
          'font-mono t2',
          // The card exists only while it is a target: no box at rest, a boundary
          // the instant a drag begins, and a fill plus an inner ring where it lands.
          dragging && 'border-gray-7!',
          over && 'bg-gray-3 shadow-[inset_0_0_0_2px_var(--white)]',
        )}
      >
        <FieldHead className={cn(ROSTER_COLS, 'font-mono t2', !firstGroup && 'hidden xl:grid')}>
          <span />
          <span />
          <span className="t1 font-sans">Competitor</span>
          <span className="tick t1 font-sans text-right">Age</span>
          <span className="tick t1 font-sans text-right">lb</span>
          <span />
        </FieldHead>
        {kids.length === 0
          ? (
            // 7.10: an empty state carries a verb on a real control. A sentence with
            // nothing to press is a dead end on the one screen a new organizer starts on.
            <EmptyState
              message="No competitors here yet."
              action={onAdd && <Button size="sm" variant="ghost" onClick={onAdd}>Add a competitor</Button>}
            />
          )
          : (
            <div role="list">
              {kids.map(k => (
                <RosterRow
                  key={k.id}
                  kid={k}
                  selected={selected.has(k.id)}
                  fault={faults.has(k.id)}
                  inMatch={inMatch.has(k.id)}
                  onSelect={(v, range) => onSelect(k.id, v, range)}
                  onPatch={body => onPatch(k.id, body)}
                  onRemove={() => onRemove(k)}
                  onDragStart={onDragStart}
                />
              ))}
            </div>
          )}
      </FieldSet>
    </section>
  )
}
