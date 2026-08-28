import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PinGate } from '@/components/PinGate'
import { AdminShell } from '@/components/AdminShell'
import { TeamDot } from '@/components/TeamDot'
import { NewEventDialog } from './admin/NewEventDialog'
import { useEvents } from '@/lib/queries'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

function EventList() {
  const events = useEvents()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <AdminShell title="Events" actions={<Button onClick={() => setOpen(true)}>New event</Button>}>
      <NewEventDialog open={open} onOpenChange={setOpen} onCreated={d => navigate(`/events/${d.event.id}`)} />
      {events.isLoading && <p className="text-muted-foreground">Loading</p>}
      {events.error && <p role="alert" className="text-destructive">{events.error.message}</p>}
      {events.data?.length === 0 && <p className="text-muted-foreground">No events yet. Create the first one.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {events.data?.map(ev => (
          <Card key={ev.id}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{ev.name}</span>
                  <Badge variant="secondary">{ev.status}</Badge>
                </div>
                <div className="text-sm text-muted-foreground">{ev.date} &middot; {ev.matCount} {ev.matCount === 1 ? 'mat' : 'mats'}</div>
                <div className="mt-1 flex gap-4 text-sm">
                  {ev.teams.map(t => <TeamDot key={t.id} color={t.color} name={t.name} />)}
                </div>
              </div>
              <Link to={`/board/${ev.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Board</Link>
              <Link to={`/events/${ev.id}`} className={buttonVariants({ size: 'sm' })}>Open</Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </AdminShell>
  )
}

export default function AdminPage() {
  return <PinGate><EventList /></PinGate>
}
