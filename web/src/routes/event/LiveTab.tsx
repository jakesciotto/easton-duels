import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Ellipsis } from 'lucide-react'
import { Menu } from '@base-ui/react/menu'
import type { MatView, MatchSide, MatchView, Snapshot } from '@shared/types'
import { formatClock, remainingMs } from '@shared/clock'
import { ApiError } from '@/lib/api'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { newEventId } from '@/lib/ids'
import { useSnapshot } from '@/lib/useSnapshot'
import { DESK_NOTE, DESK_NOTE_DETAIL, modeOf } from '@/lib/eventMode'
import { useClock } from '@/lib/useClock'
import { pollIntervalForSnapshot } from '@/lib/pollInterval'
import { teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { EventDetail } from '@/lib/types'
import { Clock } from '@/components/Clock'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Connecting } from '@/components/Connecting'
import { QrCode } from '@/components/QrCode'
import { TeamPlate } from '@/components/TeamPlate'
import { ResultDialog } from './ResultDialog'
import {
  NEXT_QUEUE_CAP, lastResultOf, matPanelModel, needsDecision, queueRemainderLabel, resultScore,
  resultSentence, resultTime, waitingLabel, type PanelTone,
} from './live-panel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { FieldHead, FieldRow, FieldSet } from '@/components/ui/field-set'
import { Toggle } from '@/components/ui/toggle'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ConnectInfo { url: string; matCode: string }
interface EndTarget { match: MatchView; matNumber: number }

// The rule is the panel's leading edge (7.3) and the word beside the mat number is the
// same state said out loud, so the panel never depends on hue alone.
const RULE: Record<PanelTone, string> = { live: 'bg-live', attend: 'bg-attend', neutral: 'bg-gray-7' }
const WORD: Record<PanelTone, string> = { live: 'text-live', attend: 'text-attend', neutral: 'text-gray-10' }

// Edge, name, figure. 2.7: --col-num-s is 2ch + 24px measured at the row's own size, so
// the grid that declares it carries the mono face AND t7 -- at any smaller size the track
// resolves narrower than the 32px two digit score it exists to hold. The name cell takes
// its own family and size back.
const NOW_COLS = 'grid grid-cols-[var(--col-state)_minmax(0,1fr)_var(--col-num-s)] items-stretch gap-x-3 gap-y-1 font-mono t7'
const NEXT_COLS = 'grid grid-cols-[var(--col-state)_minmax(0,1fr)] items-stretch gap-x-3 gap-y-1'

export function LiveTab({ detail }: { detail: EventDetail }) {
  const eventId = detail.event.id
  // 4.4 / WCAG 2.2.2: the operator can stop the picture. The pause lives on the shared
  // stream, not here, so the shell's freshness readout reports the frozen rack instead
  // of claiming live data over a screen the operator deliberately stopped.
  const { snapshot: view, connected, lastSuccessAt, paused, waiting, setPaused, live } = useSnapshot(eventId)
  const [connect, setConnect] = useState<ConnectInfo | null>(null)
  const [editing, setEditing] = useState<MatchView | null>(null)
  const [ending, setEnding] = useState<EndTarget | null>(null)
  const [finishOpen, setFinishOpen] = useState(false)
  // One client event id per match end, held across retries so a resend the server has
  // already applied is deduped rather than ending the next match too.
  const endIds = useRef<Record<number, string>>({})
  // The stream this tab already polls, not the event detail: the detail is a react-query
  // cache that nothing invalidates when the organizer switches the event from a phone, so
  // reading it here left this laptop showing the mat rack and its connect card while the
  // television in the same room had already repainted as the Final Score panel.
  const entryMode = modeOf(live, detail.event.mode) === 'entry'

  useEffect(() => {
    if (entryMode) return
    let ignore = false
    adminApi<ConnectInfo>(`/api/events/${eventId}/connect`).then(c => { if (!ignore) setConnect(c) }).catch(() => {})
    return () => { ignore = true }
  }, [eventId, entryMode])

  const status = useAdminMutation(eventId, (s: 'live' | 'done') => adminApi(`/api/events/${eventId}`, { method: 'PATCH', body: { status: s } }))
  const act = useAdminMutation(eventId, (v: { id: number; action: 'reopen' | 'skip' }) => adminApi(`/api/matches/${v.id}/${v.action}`, { method: 'POST' }))
  const end = useAdminMutation(eventId, (v: { id: number; entryId: string; lastSeq: number; winnerAthleteId?: number }) =>
    adminApi(`/api/matches/${v.id}/end`, {
      method: 'POST',
      body: v.winnerAthleteId === undefined
        ? { id: v.entryId, lastSeq: v.lastSeq }
        : { id: v.entryId, lastSeq: v.lastSeq, winnerAthleteId: v.winnerAthleteId },
    }))

  // Only the most recently started action's error stays visible.
  const runStart = () => { act.reset(); end.reset(); status.mutate('live') }
  const runAct = (v: { id: number; action: 'reopen' | 'skip' }) => { status.reset(); end.reset(); act.mutate(v) }
  const closeFinish = () => {
    setFinishOpen(false)
    status.reset()
  }
  const runFinish = () => {
    act.reset()
    end.reset()
    status.mutate('done', { onSuccess: closeFinish })
  }

  const pollIntervalMs = pollIntervalForSnapshot(live)

  const runEnd = (target: EndTarget, winnerAthleteId?: number) => {
    status.reset()
    act.reset()
    const { match } = target
    const entryId = endIds.current[match.id] ?? (endIds.current[match.id] = newEventId())
    // The action lands on the room, not on the picture: while the rack is paused the
    // frozen match view can be several writes behind, and the guard rejects a stale seq.
    const newest = live?.matches.find(m => m.id === match.id) ?? match
    end.mutate({ id: match.id, entryId, lastSeq: newest.lastSeq, winnerAthleteId }, {
      onSuccess: () => {
        delete endIds.current[match.id]
        setEnding(null)
      },
      onError: e => {
        if (e instanceof ApiError && e.code === 'decision_required') setEnding(target)
      },
    })
  }

  const onPrimary = (target: EndTarget) => {
    if (needsDecision(target.match)) {
      end.reset()
      setEnding(target)
      return
    }
    runEnd(target)
  }

  // While the dialog is open a failed finish is shown inside it only, and a decision
  // the dialog is asking for is not an error the rack has to repeat.
  const error = (finishOpen ? null : status.error) ?? act.error ?? (ending ? null : end.error)
  const matUrl = connect ? `${connect.url}/mat?event=${eventId}` : ''
  const teamColor = (teamId: number | null) => detail.teams.find(t => t.id === teamId)?.color ?? detail.teams[0].color

  const mats = [...(view?.mats ?? [])].sort((a, b) => a.number - b.number)
  const allBound = mats.length > 0 && mats.every(m => m.bound)
  const done = detail.event.status === 'done'

  return (
    <div className="grid gap-6">
      <Connecting connected={connected} />

      <div className="flex flex-wrap items-center gap-3">
        <h3 className="t4">{done ? 'Final result' : 'Mats'}</h3>
        <div className="ml-auto flex items-center gap-3">
          {!done && (
            <Button
              variant="secondary"
              size="sm"
              disabled={live === null}
              aria-label={paused ? waitingLabel(waiting) : 'Pause updates'}
              onClick={() => setPaused(!paused)}
            >
              {paused
                ? <>Paused, <span className="fig text-attend">{waiting}</span> {waiting === 1 ? 'update' : 'updates'} waiting</>
                : 'Pause updates'}
            </Button>
          )}
          {detail.event.status === 'setup' && <Button size="sm" onClick={runStart} disabled={status.isPending}>Start event</Button>}
          {detail.event.status === 'live' && (
            <Button size="sm" variant="destructive" onClick={() => setFinishOpen(true)} disabled={status.isPending}>Finish event</Button>
          )}
        </div>
      </div>

      {error && (
        <Alert>
          <AlertTitle>That did not go through</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {done ? (
        // The record is never a paused picture, so it reads the live snapshot even if the
        // rack was frozen when the event finished.
        <FinalResult view={live} eventId={eventId} />
      ) : (
        <>
          {entryMode
            ? <DeskCard />
            : <ConnectCard connect={connect} eventId={eventId} matUrl={matUrl} collapsed={allBound} matCount={mats.length} />}
          {view === null && <p className="t3 text-gray-10">Waiting for the first update from the server.</p>}
          {view !== null && mats.length === 0 && <p className="t3 text-gray-10">This event has no mats.</p>}
          {view !== null && mats.length > 0 && entryMode && (
            <p className="t2 text-gray-10">No iPad is scoring these mats. They follow the running order so the desk can see what is next.</p>
          )}
          {view !== null && (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
              {mats.map(mat => (
                <MatPanel
                  key={mat.id}
                  mat={mat}
                  view={view}
                  paused={paused}
                  lastSuccessAt={lastSuccessAt}
                  pollIntervalMs={pollIntervalMs}
                  busy={end.isPending && mat.current !== null && end.variables?.id === mat.current.id}
                  teamColor={teamColor}
                  onPrimary={onPrimary}
                  onSkip={id => runAct({ id, action: 'skip' })}
                  onReopen={id => runAct({ id, action: 'reopen' })}
                  onEditResult={setEditing}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={finishOpen} onOpenChange={o => { if (o) setFinishOpen(true); else closeFinish() }}>
        <DialogContent className={dialogSurface(512)}>
          <DialogHeader><DialogTitle>Finish the event?</DialogTitle></DialogHeader>
          <DialogBody className={dialogBody}>
            <p className="t3 text-gray-11">The board switches to the final result. Matches that are still running stay where they are.</p>
            {status.error && <Alert><AlertTitle>The event did not finish</AlertTitle><AlertDescription>{status.error.message}</AlertDescription></Alert>}
          </DialogBody>
          <DialogFooter className={dialogFooter}>
            <Button type="button" variant="secondary" onClick={closeFinish}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={status.isPending} onClick={runFinish}>Finish event</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EndDialog
        target={ending}
        pending={end.isPending}
        error={end.error}
        teamColor={teamColor}
        onCancel={() => { setEnding(null); end.reset() }}
        onEnd={winnerAthleteId => { if (ending) runEnd(ending, winnerAthleteId) }}
      />
      <ResultDialog detail={detail} match={editing} open={editing !== null} onOpenChange={o => { if (!o) setEditing(null) }} />
    </div>
  )
}

// The connect card exists to hand a mat code to a tablet, and in entry mode there is no
// tablet to hand it to. Stating the mode is the whole job: an operator who lands here and
// finds a code would spend the afternoon on a mat nothing is ever going to score. The
// standalone connect page prints the same two sentences from the same constants.
function DeskCard() {
  return (
    <div className="grid gap-1 rounded-lg bg-gray-1 px-4 py-3">
      <p className="t2 text-gray-11">{DESK_NOTE}</p>
      <p className="t2 text-gray-10">{DESK_NOTE_DETAIL}</p>
    </div>
  )
}

function ConnectCard({ connect, eventId, matUrl, collapsed, matCount }: {
  connect: ConnectInfo | null
  eventId: number
  matUrl: string
  collapsed: boolean
  matCount: number
}) {
  if (collapsed) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-1 px-4 py-3">
        <p className="t2 text-gray-11">
          {matCount === 1 ? 'The mat has a scorer connected.' : `All ${matCount} mats have a scorer connected.`}
        </p>
        <p className="t2 text-gray-10">Mat code <span className="fig fig-4 text-gray-11">{connect?.matCode ?? ''}</span></p>
        <Link to={`/connect?event=${eventId}`} target="_blank" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'ml-auto' })}>
          Open the connect page
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg bg-gray-2 p-4">
      {connect ? <QrCode text={matUrl} size={160} /> : <div style={{ width: 160, height: 160 }} className="rounded-lg bg-gray-3" aria-hidden />}
      <div className="grid gap-3">
        <div className="grid gap-1">
          <span className="t1 text-gray-10 uppercase">iPads open</span>
          <span className="font-mono t3 text-gray-11">{connect?.url ?? 'Loading'}</span>
        </div>
        <div className="grid gap-1">
          <span className="t1 text-gray-10 uppercase">Mat code</span>
          <span className="fig fig-4 t9 text-gray-12">{connect?.matCode ?? ''}</span>
        </div>
        <Link to={`/connect?event=${eventId}`} target="_blank" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'w-fit px-0' })}>
          Open the connect page
        </Link>
      </div>
    </div>
  )
}

function MatPanel({ mat, view, paused, lastSuccessAt, pollIntervalMs, busy, teamColor, onPrimary, onSkip, onReopen, onEditResult }: {
  mat: MatView
  view: Snapshot
  paused: boolean
  lastSuccessAt: number | null
  pollIntervalMs: number
  busy: boolean
  teamColor: (teamId: number | null) => string
  onPrimary: (target: EndTarget) => void
  onSkip: (matchId: number) => void
  onReopen: (matchId: number) => void
  onEditResult: (match: MatchView) => void
}) {
  const current = mat.current
  const clock = current?.clock ?? null
  const live = useClock(clock, view.now, lastSuccessAt, pollIntervalMs)
  // A paused rack must not tick: the readout freezes at the instant the snapshot the
  // panel is rendering was taken.
  const held = clock === null ? 0 : remainingMs(clock, Date.parse(view.now))
  const remaining = paused ? held : live.remainingMs
  const expired = clock !== null && remaining <= 0

  const model = matPanelModel(mat, view.event.status, expired)
  const last = lastResultOf(view.matches, mat.id)
  // Finding 1 / 6.9: capped at four pairs so a deep rack cannot push the panel's
  // primary control below the fold; the remainder line still states the depth.
  const rest = mat.onDeck.slice(1)
  const queue = rest.slice(0, NEXT_QUEUE_CAP)
  const queueRemainder = rest.length - queue.length

  return (
    <section
      aria-label={`Mat ${mat.number}`}
      data-state={model.tone}
      className="relative flex min-w-0 flex-col overflow-hidden rounded-lg bg-gray-2 py-4 pr-4 pl-5"
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', RULE[model.tone])} />

      <div className="mb-3 flex items-baseline gap-2">
        <h4 className="t4">Mat {mat.number}</h4>
        <span className={cn('t1 uppercase', WORD[model.tone])}>{model.word}</span>
        <span className="ml-auto flex items-baseline gap-2">
          {clock === null
            ? <span className="fig fig-4 t5 text-gray-9">--:--</span>
            : paused
              ? <span className="fig fig-4 t5 text-gray-10">{formatClock(remaining)}</span>
              : <Clock clock={clock} serverNow={view.now} lastSuccessAt={lastSuccessAt} pollIntervalMs={pollIntervalMs} className="t5" />}
        </span>
        <PanelMenu
          label={`Mat ${mat.number} actions`}
          items={[
            { key: 'skip', label: 'Skip this match', disabled: current === null, onSelect: () => { if (current) onSkip(current.id) } },
            { key: 'reopen', label: 'Reopen the last match', disabled: last === null, onSelect: () => { if (last) onReopen(last.id) } },
            { key: 'edit', label: 'Edit the last result', disabled: last === null, onSelect: () => { if (last) onEditResult(last) } },
          ]}
        />
      </div>

      <div className="min-w-0">
        <Lane label="Now">
          {current === null
            ? <p className="t3 text-gray-10">No match bound</p>
            : (
              <div className={NOW_COLS}>
                {[current.a, current.b].map(side => (
                  <Fragment key={side.athleteId}>
                    <span aria-hidden style={teamStyle(teamColor(side.teamId))} className="bg-[var(--team)]" />
                    <span className="min-w-0 self-center truncate font-sans t5">{side.name}</span>
                    <span className={cn('fig fig-2 self-center text-right', leadClass(side, current))}>{side.score}</span>
                  </Fragment>
                ))}
              </div>
            )}
        </Lane>

        <Lane label="Next">
          {mat.onDeck.length === 0
            ? <p className="t3 text-gray-10">{model.queueNote}</p>
            : (
              <>
                <div className={NEXT_COLS}>
                  {[mat.onDeck[0].a, mat.onDeck[0].b].map(side => (
                    <Fragment key={side.athleteId}>
                      <span aria-hidden style={teamStyle(teamColor(side.teamId))} className="bg-[var(--team)]" />
                      <span className="min-w-0 self-center truncate t3 text-gray-11">{side.name}</span>
                    </Fragment>
                  ))}
                </div>
                {queue.length > 0 && (
                  <div className="mt-2 grid gap-1">
                    {queue.map(m => (
                      <div key={m.id} className="grid grid-cols-[var(--col-state)_minmax(0,1fr)] gap-x-3">
                        <span />
                        <span className="truncate t2 text-gray-10">{m.a.name} vs {m.b.name}</span>
                      </div>
                    ))}
                    {queueRemainder > 0 && (
                      <div className="grid grid-cols-[var(--col-state)_minmax(0,1fr)] gap-x-3">
                        <span />
                        <span className="truncate t2 text-gray-10">{queueRemainderLabel(queueRemainder)}</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
        </Lane>

        <Lane label="Last result">
          {last === null
            ? <p className="t3 text-gray-10">No result recorded on mat {mat.number} yet</p>
            : (
              <div className="grid grid-cols-[var(--col-state)_minmax(0,1fr)_auto_auto] items-center gap-x-3">
                <span aria-hidden style={teamStyle(teamColor(winnerTeamId(last)))} className="h-4 bg-[var(--team)]" />
                <span className="min-w-0 truncate t2 text-gray-10">{resultSentence(last)}</span>
                <span className="fig fig-3 t2 text-right text-gray-10">{resultScore(last)}</span>
                <span className="fig t2 text-right text-gray-10">{resultTime(last.endedAt)}</span>
              </div>
            )}
        </Lane>
      </div>

      <div className="mt-auto pt-3">
        {/*
          One control, and its appearance is the report. The attend fill takes no hover
          colour: the system holds exactly one --attend value, and a hover step would
          have to invent a second.
        */}
        <Button
          size="lg"
          variant="secondary"
          disabled={model.control.disabled || busy}
          className={cn('w-full', model.control.tone === 'attend' && 'bg-attend text-black shadow-primary hover:bg-attend active:bg-attend')}
          onClick={() => { if (current) onPrimary({ match: current, matNumber: mat.number }) }}
        >
          {model.control.label}
        </Button>
      </div>
    </section>
  )
}

function Lane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-gray-7 py-3 first:border-t-0 first:pt-0">
      <div className="mb-2 t1 text-gray-10 uppercase">{label}</div>
      {children}
    </div>
  )
}

function leadClass(side: MatchSide, match: MatchView): string {
  const other = side === match.a ? match.b : match.a
  return side.score >= other.score ? 'text-fig-lead' : 'text-fig-trail'
}

function winnerTeamId(match: MatchView): number | null {
  if (!match.result) return match.a.teamId
  return match.result.winnerAthleteId === match.a.athleteId ? match.a.teamId : match.b.teamId
}

interface MenuItemSpec { key: string; label: string; disabled: boolean; onSelect: () => void }

// 6.9: the panel face holds the one action that matters and the overflow holds the rare
// ones, instead of a row of identical grey text links.
function PanelMenu({ label, items }: { label: string; items: MenuItemSpec[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} className={buttonVariants({ variant: 'ghost', size: 'xs', className: 'self-center' })}>
        <Ellipsis />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="isolate z-50">
          <Menu.Popup className="min-w-48 origin-(--transform-origin) rounded-xl border border-border bg-popover p-1 shadow-dialog">
            {items.map(item => (
              <Menu.Item
                key={item.key}
                disabled={item.disabled}
                onClick={item.onSelect}
                className="flex cursor-default items-center rounded-md px-2.5 py-1.5 t3 text-gray-11 outline-none select-none data-disabled:opacity-50 data-highlighted:bg-gray-4 data-highlighted:text-white"
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

// 6.9's done state. The rack has nothing left to report, so the composition changes
// rather than emptying, and no control on it implies the event can still be scored.
function FinalResult({ view, eventId }: { view: Snapshot | null; eventId: number }) {
  if (view === null) return <p className="t3 text-gray-10">Waiting for the first update from the server.</p>
  const played = (teamId: number) => view.matches.filter(m => m.status === 'done' && (m.a.teamId === teamId || m.b.teamId === teamId)).length
  // Finding 2: the head and each row were separate grid containers with `auto` numeric
  // tracks, so each sized its own columns from its own content -- the head from its
  // 11px labels, a row from Wins at t7 and Points/Matches at t5, three different `ch`
  // contexts in one declared track. `ch` only resolves against the element it is
  // declared on, so a shared literal-px track (2.7's own resolved-widths table, not a
  // relative one) is what lets the head and every row land on the identical register
  // regardless of which type step each renders its own figure at: Wins is 2ch at t7
  // (62.4px), Points and Matches are 3ch at t5 (60px).
  const cols = 'grid grid-cols-[minmax(0,1fr)_62.4px_60px_60px] items-center gap-x-6'
  return (
    <div className="grid gap-4">
      <FieldSet>
        <FieldHead className={cols}>
          <span className="font-sans">Team</span>
          <span className="tick text-right font-sans">Wins</span>
          <span className="tick text-right font-sans">Points</span>
          <span className="tick text-right font-sans">Matches</span>
        </FieldHead>
        {view.teams.map(team => (
          <FieldRow key={team.id} className={cn(cols, 'h-14')}>
            <TeamPlate color={team.color} name={team.name} />
            <span className="fig fig-2 t7 text-right text-fig-lead">{team.wins}</span>
            <span className="fig fig-3 t5 text-right text-gray-11">{team.points}</span>
            <span className="fig fig-3 t5 text-right text-gray-11">{played(team.id)}</span>
          </FieldRow>
        ))}
      </FieldSet>
      <div className="flex flex-wrap items-center gap-4">
        <Link to={`/board/${eventId}`} target="_blank" className={buttonVariants({ size: 'lg' })}>Open board</Link>
        <p className="t2 text-gray-10">This event is finished. The record lives at /board/{eventId}.</p>
      </div>
    </div>
  )
}

function EndDialog({ target, pending, error, teamColor, onCancel, onEnd }: {
  target: EndTarget | null
  pending: boolean
  error: Error | null
  teamColor: (teamId: number | null) => string
  onCancel: () => void
  onEnd: (winnerAthleteId: number) => void
}) {
  const [pick, setPick] = useState<number | null>(null)
  const matchId = target?.match.id ?? null
  // A fresh ask always starts empty, so a cancelled decision never hands the next match
  // a winner nobody picked.
  useEffect(() => { setPick(null) }, [matchId])
  if (target === null) return null
  const { match, matNumber } = target
  return (
    <Dialog open onOpenChange={o => { if (!o) onCancel() }}>
      {/*
        6.18: below 640px this goes full screen like every other dialog. A tie needs a
        decision, and the organizer takes that decision on a phone at the desk.
      */}
      <DialogContent className={dialogSurface(512)}>
        <DialogHeader><DialogTitle>Who won on mat {matNumber}?</DialogTitle></DialogHeader>
        <DialogBody className={dialogBody}>
          <p className="t3 text-gray-11">The scores are level, so this one ends on a referee decision.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[match.a, match.b].map(side => (
              <Toggle
                key={side.athleteId}
                pressed={pick === side.athleteId}
                onPressedChange={() => setPick(side.athleteId)}
                className="w-full"
              >
                <span aria-hidden style={teamStyle(teamColor(side.teamId))} className="size-2 shrink-0 rounded-full bg-[var(--team)]" />
                <span className="truncate">{side.name} wins</span>
              </Toggle>
            ))}
          </div>
          {error && <Alert><AlertTitle>The match did not end</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>}
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={pick === null || pending} onClick={() => { if (pick !== null) onEnd(pick) }}>End match</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
