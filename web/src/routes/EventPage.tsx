import { useParams, Link } from 'react-router'
import type { EventStatus } from '@shared/types'
import { PinGate } from '@/components/PinGate'
import { AdminShell } from '@/components/AdminShell'
import { RouteFallback } from '@/components/RouteFallback'
import { useEventDetail } from '@/lib/queries'
import { useSnapshot } from '@/lib/useSnapshot'
import { pollIntervalForSnapshot } from '@/lib/pollInterval'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
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

const PANEL = 'px-6 pt-6 pb-10'

function EventBody({ eventId }: { eventId: number }) {
  const q = useEventDetail(eventId)
  // 6.4: the header's freshness readout wants the same lastSuccessAt a poll already
  // produces. This is a poll of its own, independent of whatever the Live tab is doing --
  // lifting a single shared poll out of LiveTab would mean editing a file outside this
  // task's scope, so the shell asks on its own rather than fabricate a status it can't see.
  const { snapshot, lastSuccessAt } = useSnapshot(eventId)
  if (q.isLoading) return <RouteFallback rung="two-line" />
  if (q.error || !q.data) {
    return (
      <AdminShell title="Event">
        <div className={PANEL}>
          <Alert>
            <AlertDescription>{q.error?.message ?? 'Not found'}</AlertDescription>
          </Alert>
        </div>
      </AdminShell>
    )
  }
  const detail = q.data
  return (
    <AdminShell
      title={detail.event.name}
      status={<Badge variant={STATUS[detail.event.status].variant}>{STATUS[detail.event.status].label}</Badge>}
      actions={<Link to={`/board/${eventId}`} target="_blank" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Open board</Link>}
      freshness={{ lastSuccessAt, pollIntervalMs: pollIntervalForSnapshot(snapshot) }}
      meta={
        <div className="flex items-center gap-3 t2 text-gray-10">
          <span className="fig">{detail.event.date}</span>
          <span><span className="fig">{detail.athletes.length}</span> competitors</span>
          <span><span className="fig">{detail.matches.length}</span> matches</span>
        </div>
      }
    >
      <Tabs defaultValue="roster" className="gap-0">
        <TabsList className="px-6">
          <TabsTrigger value="roster">Roster<span className="ml-1.5 fig text-gray-10">{detail.athletes.length}</span></TabsTrigger>
          <TabsTrigger value="entry">Entry</TabsTrigger>
          <TabsTrigger value="rulesets">Rulesets</TabsTrigger>
          <TabsTrigger value="matches">Matches<span className="ml-1.5 fig text-gray-10">{detail.matches.length}</span></TabsTrigger>
          <TabsTrigger value="live">Live</TabsTrigger>
        </TabsList>
        <TabsContent value="roster" className={PANEL}><RosterTab detail={detail} /></TabsContent>
        <TabsContent value="entry" className={PANEL}><EntryTab detail={detail} /></TabsContent>
        <TabsContent value="rulesets" className={PANEL}><RulesetsTab detail={detail} /></TabsContent>
        <TabsContent value="matches" className={PANEL}><MatchesTab detail={detail} /></TabsContent>
        <TabsContent value="live" className={PANEL}><LiveTab detail={detail} /></TabsContent>
      </Tabs>
    </AdminShell>
  )
}

export default function EventPage() {
  const { eventId } = useParams()
  return <PinGate><EventBody eventId={Number(eventId)} /></PinGate>
}
