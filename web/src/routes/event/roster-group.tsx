import type { PointerEvent as ReactPointerEvent } from 'react'
import type { AthleteRow } from '@/lib/types'
import { TeamPlate } from '@/components/TeamPlate'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldHead, FieldSet } from '@/components/ui/field-set'
import { cn } from '@/lib/utils'
import { DROP_ATTR, dropZoneValue } from './roster-drag'
import { ROSTER_COLS, RosterRow } from './roster-row'

export function RosterGroup({
  title, color, teamId, kids, selected, faults, firstGroup, dragging, over,
  onSelect, onPatch, onRemove, onDragStart,
}: {
  title: string
  color: string | null
  teamId: number | null
  kids: AthleteRow[]
  selected: Set<number>
  faults: Set<number>
  firstGroup: boolean
  dragging: boolean
  over: boolean
  onSelect: (id: number, v: boolean, range: boolean) => void
  onPatch: (id: number, body: Partial<AthleteRow>) => void
  onRemove: (kid: AthleteRow) => void
  onDragStart: (e: ReactPointerEvent, id: number) => void
}) {
  return (
    <section aria-label={title} className="min-w-0" {...{ [DROP_ATTR]: dropZoneValue(teamId) }}>
      {/* Below 1280 the three columns are one field, so the group head pins itself
          as a subhead over the ground rather than sitting beside its neighbours. */}
      <div className="sticky top-0 z-10 flex h-10 items-center gap-3 bg-background xl:static xl:h-8 xl:bg-transparent">
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
          ? <EmptyState message="No competitors here yet" />
          : (
            <div role="list">
              {kids.map(k => (
                <RosterRow
                  key={k.id}
                  kid={k}
                  selected={selected.has(k.id)}
                  fault={faults.has(k.id)}
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
