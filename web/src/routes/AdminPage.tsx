import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PinGate } from '@/components/PinGate'
import { AdminShell } from '@/components/AdminShell'
import { RouteFallback } from '@/components/RouteFallback'
import { TeamPlate } from '@/components/TeamPlate'
import { NewEventDialog } from './admin/NewEventDialog'
import { useEvents } from '@/lib/queries'
import type { EventSummary } from '@/lib/types'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FieldSet, FieldHead, FieldRow } from '@/components/ui/field-set'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

// 6.2: state rule replaces the status badge as the second read -- live for a live event,
// gray-7 for setup, transparent (nothing to report) for done.
const STATE_RULE: Record<EventSummary['status'], string> = {
  live: 'bg-live',
  setup: 'bg-gray-7',
  done: 'bg-transparent',
}

// Finding 5: `ch` (and so var(--col-num-s)) resolves against each element's own
// font-size. The head was left at the general t1 column-head size while a row
// inherited the shell's ambient t3, both on the sans face, so the shared string
// still resolved the Mats track to two different pixel widths. Both are pinned to
// the mono face at the row's own t2 -- the same technique the roster row and the
// candidate row already document -- and the labels take t1 back on themselves.
const ROW = 'grid h-10 grid-cols-[var(--col-state)_minmax(0,1fr)_92px_var(--col-num-s)_auto] items-center gap-x-3 font-mono t2'

function EventRow({ ev }: { ev: EventSummary }) {
  const [teamA, teamB] = ev.teams
  return (
    <FieldRow className={cn(ROW, 'relative')}>
      <span aria-hidden className={cn('h-full self-stretch', STATE_RULE[ev.status])} />
      {/* The row sets the mono face so the numeric track resolves ch correctly.
          Every cell holding words takes the sans face back. */}
      <div className="flex min-w-0 items-center gap-3 font-sans">
        {/* The name is the row's link, so the whole row has to be its target. Left as
            text alone the hit area is the glyphs: an event named "test" gives a 25 by
            20px target in a 1102 by 40px row, which reads as a row that does nothing.
            The overlay takes the target to the row itself, which is the default 40px
            rung by the full column width. That clears WCAG 2.5.8's 24px minimum; it
            does not reach the 44px of 2.5.5, which the rung would have to grow for. */}
        <Link
          to={`/events/${ev.id}`}
          className="truncate t3 font-medium text-gray-12 outline-none after:absolute after:inset-0 after:rounded-none focus-visible:shadow-focus"
        >
          {ev.name}
        </Link>
        {teamA && <TeamPlate color={teamA.color} name={teamA.name} size="inline" />}
        {teamB && <TeamPlate color={teamB.color} name={teamB.name} size="inline" />}
      </div>
      <span className="fig text-gray-10">{ev.date}</span>
      <span className="fig text-right text-gray-10">{ev.matCount}</span>
      {/* Above the row overlay, or the only other destination in the row is unreachable. */}
      <Link to={`/board/${ev.id}`} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'relative font-sans')}>Board</Link>
    </FieldRow>
  )
}

function EventList() {
  const events = useEvents()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  if (events.isLoading) return <RouteFallback tabs={false} rung="default" />

  return (
    <AdminShell title="Events" actions={<Button size="sm" onClick={() => setOpen(true)}>New event</Button>}>
      <NewEventDialog open={open} onOpenChange={setOpen} onCreated={d => navigate(`/events/${d.event.id}`)} />
      <div className="grid gap-6 px-6 pb-10">
        {events.error && (
          <Alert>
            <AlertDescription>{events.error.message}</AlertDescription>
          </Alert>
        )}
        {events.data && (
          <FieldSet data-frame="card">
            <FieldHead className={ROW}>
              <span aria-hidden />
              <span className="t1 font-sans">Event</span>
              <span className="tick t1 font-sans text-right">Date</span>
              <span className="tick t1 font-sans text-right">Mats</span>
              <span className="sr-only">Board</span>
            </FieldHead>
            {events.data.length === 0
              ? (
                // Finding 6 / 7.10: a sentence with no control is a dead end. The verb
                // moves to a real inline action instead of sitting in plain grey text.
                <EmptyState
                  message="No events yet."
                  action={<Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Create the first one</Button>}
                />
              )
              : events.data.map(ev => <EventRow key={ev.id} ev={ev} />)}
          </FieldSet>
        )}
      </div>
    </AdminShell>
  )
}

export default function AdminPage() {
  return <PinGate><EventList /></PinGate>
}
