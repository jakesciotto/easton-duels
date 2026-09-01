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

const ROW = 'grid h-10 grid-cols-[var(--col-state)_minmax(0,1fr)_92px_var(--col-num-s)_auto] items-center gap-x-3'

function EventRow({ ev }: { ev: EventSummary }) {
  const [teamA, teamB] = ev.teams
  return (
    <FieldRow className={ROW}>
      <span aria-hidden className={cn('h-full self-stretch', STATE_RULE[ev.status])} />
      <div className="flex min-w-0 items-center gap-3">
        <Link to={`/events/${ev.id}`} className="truncate t3 font-medium text-gray-12 outline-none focus-visible:shadow-focus">
          {ev.name}
        </Link>
        {teamA && <TeamPlate color={teamA.color} name={teamA.name} size="inline" />}
        {teamB && <TeamPlate color={teamB.color} name={teamB.name} size="inline" />}
      </div>
      <span className="fig text-gray-10">{ev.date}</span>
      <span className="fig text-right text-gray-10">{ev.matCount}</span>
      <Link to={`/board/${ev.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Board</Link>
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
              <span>Event</span>
              <span className="tick text-right">Date</span>
              <span className="tick text-right">Mats</span>
              <span className="sr-only">Board</span>
            </FieldHead>
            {events.data.length === 0
              ? <EmptyState message="No events yet. Create the first one." />
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
