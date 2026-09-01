import { useState } from 'react'
import type { AthleteRow, EventDetail } from '@/lib/types'
import { athleteName, beltLabel } from '@/lib/format'
import { isDoubleBooked } from '@/lib/doubleBooking'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldHead, FieldSet } from '@/components/ui/field-set'
import { Input } from '@/components/ui/input'
import { Toggle } from '@/components/ui/toggle'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// 6.14's shared ledger row, rendered by the one Toggle primitive: the row that is
// already in the slot reads as pressed, so the picker states what it is replacing.
// `ch` resolves on this element, so it carries the mono face and the words opt back out.
const COLS = 'grid grid-cols-[var(--col-state)_minmax(0,1fr)_var(--col-num-s)_var(--col-num-m)_var(--col-num-m)] gap-x-3 font-mono t2'

function Cell({ value, missing = false, slot }: { value: number | null; missing?: boolean; slot: string }) {
  return (
    <span className={cn('fig text-right', slot, value === null && missing ? 'text-attend' : value === null ? 'text-gray-9' : 'text-gray-11')}>
      {value === null ? '--' : value}
    </span>
  )
}

export function KidPickerDialog({ detail, teamId, matchId, open, onOpenChange, onPick }: {
  detail: EventDetail; teamId: number | null; matchId: number | null; open: boolean
  onOpenChange: (o: boolean) => void; onPick: (athleteId: number) => void
}) {
  const [search, setSearch] = useState('')
  const team = detail.teams.find(t => t.id === teamId)
  const kids = detail.athletes
    .filter(a => a.teamId === teamId && athleteName(a).toLowerCase().includes(search.toLowerCase()))
    .sort((x, y) => x.lastName.localeCompare(y.lastName))

  // Which competitor this slot holds now. The caller names the match and the team, so
  // the incumbent is whichever side of that match belongs to this team.
  const match = detail.matches.find(m => m.id === matchId)
  const held = match
    ? [match.athleteAId, match.athleteBId].find(id => detail.athletes.find(a => a.id === id)?.teamId === teamId) ?? null
    : null

  const close = () => {
    onOpenChange(false)
    setSearch('')
  }

  const row = (k: AthleteRow) => {
    const booked = isDoubleBooked(k.id, detail.matches, matchId ?? undefined)
    return (
      <Toggle
        key={k.id}
        aria-label={athleteName(k)}
        pressed={held === k.id}
        onPressedChange={() => { onPick(k.id); close() }}
        className={cn(COLS, 'h-10 w-full items-center rounded-none border-0 border-t border-gray-7 px-3 text-left font-normal! active:scale-100')}
      >
        <span aria-hidden className={cn('h-6 w-[var(--col-state)]', booked && 'bg-attend')} />
        <span className="flex min-w-0 items-center gap-2 font-sans">
          <span className="truncate t3 text-gray-12">{athleteName(k)}</span>
          <span className="truncate t2 text-gray-10">{beltLabel(k.belt)}</span>
          {booked && <span className="shrink-0 t2 text-attend">double-booked</span>}
        </span>
        <Cell value={k.age} missing slot="fig-2" />
        <Cell value={k.weightLbs} missing slot="fig-3" />
        <span className={cn('fig fig-4 text-right', k.erp === null ? 'text-gray-9' : 'text-gray-12')}>
          {k.erp === null ? '--' : k.erp.toFixed(1)}
        </span>
      </Toggle>
    )
  }

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setSearch('') }}>
      <DialogContent className={dialogSurface(512)}>
        <DialogHeader><DialogTitle>Pick a {team?.name ?? ''} competitor</DialogTitle></DialogHeader>
        <DialogBody className={cn(dialogBody, 'gap-4')}>
          <Input aria-label="Search competitors" autoFocus value={search} onChange={e => setSearch(e.target.value)} />
          <FieldSet className="max-h-[320px] overflow-y-auto rounded-none">
            <FieldHead className={COLS}>
              <span />
              <span className="t1 uppercase">Competitor</span>
              <span className="tick t1 text-right uppercase">Age</span>
              <span className="tick t1 text-right uppercase">Weight</span>
              <span className="tick t1 text-right uppercase">ERP</span>
            </FieldHead>
            {kids.length === 0
              ? <EmptyState
                  message="No competitors match. Clear the search."
                  action={<Button size="sm" variant="ghost" onClick={() => setSearch('')}>Clear search</Button>}
                />
              : kids.map(row)}
          </FieldSet>
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
