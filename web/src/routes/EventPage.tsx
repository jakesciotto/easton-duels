import { useMemo } from 'react'
import { useParams, Link } from 'react-router'
import { Field } from '@base-ui/react/field'
import type { EventMode, EventStatus } from '@shared/types'
import { PinGate } from '@/components/PinGate'
import { AdminShell } from '@/components/AdminShell'
import { RouteFallback } from '@/components/RouteFallback'
import { adminApi, useAdminMutation, useEventDetail } from '@/lib/queries'
import { SnapshotStreamContext, useSnapshot } from '@/lib/useSnapshot'
import { pollIntervalForSnapshot } from '@/lib/pollInterval'
import { MODE_GROUP_LABEL, MODE_OPTIONS, deskSwitchRefusal, modeOf, toMode } from '@/lib/eventMode'
import { cn } from '@/lib/utils'
import type { EventDetail } from '@/lib/types'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Segment } from '@/components/ui/segment'
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

// 6.18: one column with 16px gutters below 640px. The panel gutter matches the shell's.
const PANEL = 'px-4 pt-6 pb-10 sm:px-6'

/**
 * The metadata strip plus the one control for the whole event, mounted on the shell so it
 * is the same control on every tab. It stays enabled while the event is live on purpose:
 * the desk path is the fallback for the day the tablets do not work, and a setting that
 * locks at Start is a setting nobody can fall back to.
 *
 * `refusal` is the whole guard (6.8). While it stands the control renders disabled and
 * the reason is printed under the strip, naming the mat. The Segment primitive takes no
 * per option disabled, so the refusal is carried by the field the group sits in: base-ui
 * reads `disabled` off the field context, marks every cell aria-disabled and refuses the
 * selection itself. Disabling the pair rather than the one cell takes nothing legal away,
 * because the refusal is only ever computed while the event is on Scored on mats and the
 * other cell is the value already held. The handler refuses too, since a programmatic
 * change can still reach it. Nothing is added to the healthy path: with no mat bound and
 * no mat carrying a match, the switch is a plain tap.
 */
function EventMeta({ eventId, detail, mode, refusal }: {
  eventId: number
  detail: EventDetail
  mode: EventMode
  refusal: string | null
}) {
  const set = useAdminMutation(eventId, (m: EventMode) => adminApi(`/api/events/${eventId}`, { method: 'PATCH', body: { mode: m } }))
  // The segment reports the write it is carrying, not the row it was rendered from: the
  // stream only catches up on the next poll, and a control that snaps back for a beat
  // reads as a refused change. A failed write drops back to the stored value.
  const shown = set.isPending && set.variables !== undefined ? set.variables : mode
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 t2 text-gray-10">
        <span className="fig">{detail.event.date}</span>
        <span><span className="fig">{detail.athletes.length}</span> competitors</span>
        <span><span className="fig">{detail.matches.length}</span> matches</span>
        <Field.Root disabled={refusal !== null} className={cn('ml-auto min-w-0', refusal !== null && 'opacity-50')}>
          <Segment
            aria-label={MODE_GROUP_LABEL}
            value={shown}
            options={MODE_OPTIONS}
            onValueChange={v => { if (refusal === null) set.mutate(toMode(v)) }}
          />
        </Field.Root>
      </div>
      {refusal !== null && <p className="t2 text-gray-10">{refusal}</p>}
      {set.error && (
        <Alert>
          <AlertTitle>How this event runs was not changed</AlertTitle>
          <AlertDescription>{set.error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function EventBody({ eventId }: { eventId: number }) {
  const q = useEventDetail(eventId)
  // 6.4 / 7.15: the one poll for this event. The header's freshness readout and every tab
  // under the provider read this same stream, so the shell can never report fresh data for
  // a screen that is deliberately frozen, and one browser tab makes one request per tick.
  const stream = useSnapshot(eventId)
  const shared = useMemo(() => ({ eventId, state: stream }), [eventId, stream])
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
  // One fact, one source: the shell, the tabs under it and the board all read the mode out
  // of the polled stream, and the detail is the fallback only until the first snapshot
  // lands. The newest snapshot rather than the shown one, because a pause freezes the mat
  // rack and not the event's own configuration, and because the guard below is a statement
  // about the room rather than about the picture.
  const mode = modeOf(stream.live, detail.event.mode)
  const refusal = mode === 'live' ? deskSwitchRefusal(stream.live) : null
  return (
    <AdminShell
      title={detail.event.name}
      status={<Badge variant={STATUS[detail.event.status].variant}>{STATUS[detail.event.status].label}</Badge>}
      actions={<Link to={`/board/${eventId}`} target="_blank" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Open board</Link>}
      freshness={{
        lastSuccessAt: stream.lastSuccessAt,
        pollIntervalMs: pollIntervalForSnapshot(stream.snapshot),
        paused: stream.paused,
        waiting: stream.waiting,
      }}
      meta={<EventMeta eventId={eventId} detail={detail} mode={mode} refusal={refusal} />}
    >
      <SnapshotStreamContext value={shared}>
        {/*
          The default tab follows the stored mode: in entry mode the Entry tab is the
          product, so a freshly opened event lands on it. Uncontrolled on purpose -- a
          mode change mid event must not throw the operator off the tab they are on.
        */}
        <Tabs defaultValue={mode === 'entry' ? 'entry' : 'roster'} className="gap-0">
          <TabsList className="px-4 sm:px-6">
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
      </SnapshotStreamContext>
    </AdminShell>
  )
}

export default function EventPage() {
  const { eventId } = useParams()
  return <PinGate><EventBody eventId={Number(eventId)} /></PinGate>
}
