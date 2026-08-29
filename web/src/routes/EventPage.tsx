import { useParams, Link } from 'react-router'
import type { EventStatus } from '@shared/types'
import { PinGate } from '@/components/PinGate'
import { AdminShell } from '@/components/AdminShell'
import { useEventDetail } from '@/lib/queries'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { RosterTab } from './event/RosterTab'
import { EntryTab } from './event/EntryTab'
import { RulesetsTab } from './event/RulesetsTab'
import { MatchesTab } from './event/MatchesTab'
import { LiveTab } from './event/LiveTab'

const STATUS: Record<EventStatus, { label: string; variant: 'default' | 'live' | 'done' }> = {
  setup: { label: 'Setup', variant: 'default' },
  live: { label: 'Live', variant: 'live' },
  done: { label: 'Done', variant: 'done' },
}

function EventBody({ eventId }: { eventId: number }) {
  const q = useEventDetail(eventId)
  if (q.isLoading) return <AdminShell title="Loading"><p className="text-faint">Loading</p></AdminShell>
  if (q.error || !q.data) return <AdminShell title="Event"><p role="alert" className="text-destructive">{q.error?.message ?? 'Not found'}</p></AdminShell>
  const detail = q.data
  return (
    <AdminShell
      title={detail.event.name}
      status={<Badge variant={STATUS[detail.event.status].variant}>{STATUS[detail.event.status].label}</Badge>}
      actions={<Link to={`/board/${eventId}`} target="_blank" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Open board</Link>}
    >
      <div className="mb-4 flex items-center gap-3 text-[13px] text-faint">
        <span className="font-mono tabular-nums">{detail.event.date}</span>
        <span><span className="font-mono tabular-nums">{detail.athletes.length}</span> kids</span>
        <span><span className="font-mono tabular-nums">{detail.matches.length}</span> matches</span>
      </div>
      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster">Roster<span className="ml-1.5 font-mono text-xs text-faint">{detail.athletes.length}</span></TabsTrigger>
          <TabsTrigger value="entry">Entry</TabsTrigger>
          <TabsTrigger value="rulesets">Rulesets</TabsTrigger>
          <TabsTrigger value="matches">Matches<span className="ml-1.5 font-mono text-xs text-faint">{detail.matches.length}</span></TabsTrigger>
          <TabsTrigger value="live">Live</TabsTrigger>
        </TabsList>
        <TabsContent value="roster"><RosterTab detail={detail} /></TabsContent>
        <TabsContent value="entry"><EntryTab detail={detail} /></TabsContent>
        <TabsContent value="rulesets"><RulesetsTab detail={detail} /></TabsContent>
        <TabsContent value="matches"><MatchesTab detail={detail} /></TabsContent>
        <TabsContent value="live"><LiveTab detail={detail} /></TabsContent>
      </Tabs>
    </AdminShell>
  )
}

export default function EventPage() {
  const { eventId } = useParams()
  return <PinGate><EventBody eventId={Number(eventId)} /></PinGate>
}
