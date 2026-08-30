import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { EventStatus } from '@shared/types'
import { PinGate } from '@/components/PinGate'
import { AdminShell } from '@/components/AdminShell'
import { TeamDot } from '@/components/TeamDot'
import { NewEventDialog } from './admin/NewEventDialog'
import { useEvents } from '@/lib/queries'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { List, ListRow } from '@/components/ui/list'

const STATUS: Record<EventStatus, { label: string; variant: 'default' | 'live' | 'done' }> = {
  setup: { label: 'Setup', variant: 'default' },
  live: { label: 'Live', variant: 'live' },
  done: { label: 'Done', variant: 'done' },
}

function EventList() {
  const events = useEvents()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <AdminShell title="Events" actions={<Button size="sm" onClick={() => setOpen(true)}>New event</Button>}>
      <NewEventDialog open={open} onOpenChange={setOpen} onCreated={d => navigate(`/events/${d.event.id}`)} />
      <div className="grid gap-6 px-6 pb-10">
        {events.isLoading && <p className="text-faint">Loading</p>}
        {events.error && <p role="alert" className="text-destructive">{events.error.message}</p>}
        {events.data?.length === 0 && (
          <List>
            <ListRow className="text-[13px] text-faint">No events yet. Create the first one.</ListRow>
          </List>
        )}
        {events.data && events.data.length > 0 && (
          <List>
            {events.data.map(ev => (
              <ListRow key={ev.id} className="flex items-center gap-3">
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{ev.name}</span>
                    <Badge variant={STATUS[ev.status].variant}>{STATUS[ev.status].label}</Badge>
                  </div>
                  <div className="flex min-w-0 items-center gap-3 text-[13px]">
                    <span className="font-mono text-faint tabular-nums">{ev.date}</span>
                    <span className="text-faint"><span className="font-mono tabular-nums">{ev.matCount}</span> {ev.matCount === 1 ? 'mat' : 'mats'}</span>
                    {ev.teams.map(t => <TeamDot key={t.id} color={t.color} name={t.name} className="text-soft" />)}
                  </div>
                </div>
                <Link to={`/board/${ev.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Board</Link>
                <Link to={`/events/${ev.id}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Open</Link>
              </ListRow>
            ))}
          </List>
        )}
      </div>
    </AdminShell>
  )
}

export default function AdminPage() {
  return <PinGate><EventList /></PinGate>
}
