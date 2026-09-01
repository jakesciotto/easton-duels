import { useMemo, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVerticalIcon } from 'lucide-react'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { useSnapshot } from '@/lib/useSnapshot'
import { pollIntervalForSnapshot } from '@/lib/pollInterval'
import type { EventDetail, MatchRow, TeamRow } from '@/lib/types'
import { athleteName, winTypeLabel } from '@/lib/format'
import { moveId } from '@/lib/reorder'
import { doubleBookedMatchIds } from '@/lib/doubleBooking'
import { cn } from '@/lib/utils'
import { KidPickerDialog } from './KidPickerDialog'
import { AddMatchDialog } from './AddMatchDialog'
import {
  endedLabel, liveReason, matchLabel, matchLines, readyNote, regenerateBlockedReason, regenerateWarning,
  skipNote, type MatchLine,
} from './matches-view'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Clock } from '@/components/Clock'
import { TeamPlate } from '@/components/TeamPlate'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Pick { matchId: number; side: 'a' | 'b'; teamId: number }

// 4.4 names 2000ms for this tab. The suspension that keeps an arriving snapshot off the
// screen while the operator is dragging, typing or picking lives in useSnapshot.

const PENDING_COLUMNS = 9

// The hovered competitor lights every row they appear in. Scanning for one child's next
// bout is the most common thing this screen is used for, and the table is too tall to
// read at once.
type Hover = (athleteId: number | null) => void

// An unfilled side reads "Unpaired, Crimson", never blank (6.8).
type NameOf = (athleteId: number, team: TeamRow) => string

interface Option { value: string; label: string }

function CompetitorLine({ team, name, onHover, onPick }: {
  team: TeamRow
  name: string
  onHover: (on: boolean) => void
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={`${name}, ${team.name}`}
      title={name}
      onClick={onPick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className="-mx-2 flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none transition-colors duration-150 ease-standard hover:bg-gray-3 focus-visible:shadow-focus active:bg-gray-4"
    >
      <TeamPlate color={team.color} name={team.name} size="inline" showName={false} />
      <span className="truncate t3">{name}</span>
    </button>
  )
}

// The live match is not one of forty identical rows. It is lifted into its own strip at
// t5, and it is where "refuse rather than ask" is visible: the controls that would touch
// a running match are disabled with the reason printed beside them.
function LiveStrip({ line, teamA, teamB, nameA, nameB, serverNow, lastSuccessAt, pollIntervalMs, highlight, onHover }: {
  line: MatchLine
  teamA: TeamRow
  teamB: TeamRow
  nameA: string
  nameB: string
  serverNow: string | null
  pollIntervalMs: number
  lastSuccessAt: number | null
  highlight: boolean
  onHover: Hover
}) {
  const reason = liveReason(line)
  return (
    <div
      data-match-state="live"
      className={cn(
        'grid gap-2 rounded-lg border-l-[3px] border-live p-4 transition-colors duration-150 ease-standard',
        highlight ? 'bg-gray-4' : 'bg-gray-2',
      )}
    >
      <div className="flex items-baseline gap-4">
        <span className="t1 text-live uppercase">Live</span>
        <span className="t1 text-gray-10 uppercase">{line.matNumber === null ? 'No mat' : `Mat ${line.matNumber}`}</span>
        <span className="t1 text-gray-10 uppercase">Match <span className="fig">{line.position}</span></span>
        <span className="ml-auto font-mono">
          <Clock
            clock={line.clock}
            serverNow={serverNow}
            lastSuccessAt={lastSuccessAt}
            pollIntervalMs={pollIntervalMs}
            className="t5 font-medium!"
          />
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 t5">
        <span className="flex min-w-0 items-center gap-2" onMouseEnter={() => onHover(line.row.athleteAId)} onMouseLeave={() => onHover(null)}>
          <TeamPlate color={teamA.color} name={teamA.name} size="inline" showName={false} />
          <span className="truncate">{nameA}</span>
        </span>
        <span className="t1 text-gray-10 uppercase">vs</span>
        <span className="flex min-w-0 items-center gap-2" onMouseEnter={() => onHover(line.row.athleteBId)} onMouseLeave={() => onHover(null)}>
          <TeamPlate color={teamB.color} name={teamB.name} size="inline" showName={false} />
          <span className="truncate">{nameB}</span>
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="t2 text-gray-10">{reason}</span>
        <Button
          size="sm" variant="destructive" title={reason} disabled
          aria-label={`Delete ${matchLabel(line.position, nameA, nameB)}`}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

/**
 * Controlled, because React writes a `defaultValue` once at mount and never again: a
 * length another operator or a Regenerate changed never reached this cell, and the
 * operator set a mat clock from a number the model had already replaced. The draft is
 * dropped whenever the served value moves and whenever a write is refused, so a value
 * on screen is either the served one or one the operator is still typing.
 */
function LengthCell({ label, value, onSave }: {
  label: string
  value: number
  onSave: (v: number, onRefused: () => void) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [served, setServed] = useState(value)
  if (served !== value) {
    setServed(value)
    setDraft(null)
  }
  const revert = () => setDraft(null)

  const commit = () => {
    if (draft === null) return
    const v = Number(draft)
    if (!Number.isInteger(v) || v < 30 || v > 1800 || v === value) {
      // A refused value must not sit on screen looking saved.
      revert()
      return
    }
    onSave(v, revert)
  }

  return (
    <input
      aria-label={label}
      inputMode="numeric"
      autoComplete="off"
      value={draft ?? String(value)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      className="fig fig-4 h-8 w-full rounded-md bg-transparent px-3 text-right outline-none transition-colors duration-150 ease-standard hover:bg-gray-3 focus-visible:bg-gray-3 focus-visible:shadow-focus"
    />
  )
}

function PendingRow({ line, teams, name, matItems, rulesetItems, index, count, doubleBooked, highlight, onHover, onPick, onPatch, onDelete, onMove }: {
  line: MatchLine
  teams: TeamRow[]
  name: NameOf
  matItems: Option[]
  rulesetItems: Option[]
  index: number
  count: number
  doubleBooked: boolean
  highlight: boolean
  onHover: Hover
  onPick: (p: Pick) => void
  onPatch: (id: number, body: Partial<MatchRow>, onError?: () => void) => void
  onDelete: (id: number) => void
  onMove: (index: number, dir: -1 | 1) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: line.row.id })
  const m = line.row
  const [teamA, teamB] = teams
  const attend = doubleBooked || line.state === 'skipped'
  const ready = line.state === 'ready' ? readyNote(line) : null
  const nameA = name(m.athleteAId, teamA)
  const nameB = name(m.athleteBId, teamB)
  // Every control below is otherwise named the same on all fourteen rows.
  const row = matchLabel(line.position, nameA, nameB)

  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-match-state={line.state}
      selected={highlight}
      className="h-16"
    >
      <TableCell className="w-[var(--col-act)] pr-0">
        <Button
          type="button" variant="ghost" size="icon" aria-label={`Reorder ${row}`}
          className="cursor-grab" {...attributes} {...listeners}
        >
          <GripVerticalIcon />
        </Button>
      </TableCell>
      {/* 2.7's state track, at the row's leading edge: the one place a state colour is
          allowed to be a rule. */}
      <TableCell className="relative w-[var(--col-state)] p-0">
        {attend && <span aria-hidden className="absolute inset-y-0 left-0 w-[var(--col-state)] bg-attend" />}
      </TableCell>
      <TableCell numeric className="w-[var(--col-num-s)] text-gray-10">{line.position}</TableCell>
      <TableCell className="w-[112px]">
        <Select
          value={String(m.matId ?? '')}
          onValueChange={v => { const next = String(v ?? ''); onPatch(m.id, { matId: next ? Number(next) : null }) }}
          items={matItems}
        >
          <SelectTrigger size="sm" aria-label={`Mat for ${row}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {matItems.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="min-w-0">
        <div className="grid min-w-0">
          <CompetitorLine
            team={teamA} name={nameA}
            onHover={on => onHover(on ? m.athleteAId : null)}
            onPick={() => onPick({ matchId: m.id, side: 'a', teamId: teamA.id })}
          />
          <CompetitorLine
            team={teamB} name={nameB}
            onHover={on => onHover(on ? m.athleteBId : null)}
            onPick={() => onPick({ matchId: m.id, side: 'b', teamId: teamB.id })}
          />
        </div>
      </TableCell>
      <TableCell className="min-w-0">
        <div className="grid min-w-0 gap-1">
          <span className="flex h-6 min-w-0 items-center">
            {m.why
              ? <Chip title={m.why}>{m.why}</Chip>
              : <span className="t2 text-gray-10">Added by hand</span>}
          </span>
          <span className="flex h-4 min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap">
            {line.state === 'skipped' && <span className="t2 text-attend">{skipNote(line)}</span>}
            {doubleBooked && <span className="t2 text-attend">Double booked</span>}
            {ready && <span className="t2 text-gray-10">{ready}</span>}
          </span>
        </div>
      </TableCell>
      {/*
        An editable cell rather than a boxed input: the length is a figure on the Ledger
        Grid's own track, and a boxed control cannot hold 4ch plus its own border inside it.
        Never type="number" (7.8): the spinner steals the track and the scroll wheel.
      */}
      <TableCell numeric className="w-[var(--col-num-l)] p-0">
        <LengthCell
          label={`Length for ${row}`}
          value={m.lengthSec}
          onSave={(lengthSec, onRefused) => onPatch(m.id, { lengthSec }, onRefused)}
        />
      </TableCell>
      <TableCell className="w-[168px]">
        <Select
          value={String(m.rulesetId)}
          onValueChange={v => { const next = String(v ?? ''); if (next) onPatch(m.id, { rulesetId: Number(next) }) }}
          items={rulesetItems}
        >
          <SelectTrigger size="sm" aria-label={`Ruleset for ${row}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {rulesetItems.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="w-px whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" aria-label={`Move ${row} up`} disabled={index === 0} onClick={() => onMove(index, -1)}>Up</Button>
          <Button size="sm" variant="ghost" aria-label={`Move ${row} down`} disabled={index === count - 1} onClick={() => onMove(index, 1)}>Down</Button>
          {/* 7.7: a destructive control never sits flush against the row's most repeated one. */}
          <Button size="sm" variant="destructive" className="ml-4" aria-label={`Delete ${row}`} onClick={() => onDelete(m.id)}>Delete</Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function SettledRow({ line, teams, name, highlight, onHover }: {
  line: MatchLine
  teams: TeamRow[]
  name: NameOf
  highlight: boolean
  onHover: Hover
}) {
  const m = line.row
  const [teamA, teamB] = teams
  const aWon = m.winnerAthleteId === m.athleteAId
  const winner = { id: aWon ? m.athleteAId : m.athleteBId, team: aWon ? teamA : teamB }
  const loser = { id: aWon ? m.athleteBId : m.athleteAId, team: aWon ? teamB : teamA }

  return (
    <TableRow data-match-state="done" selected={highlight}>
      <TableCell numeric className="w-[var(--col-num-s)] text-gray-10">{line.position}</TableCell>
      <TableCell className="w-[80px] t2 text-gray-10">{line.matNumber === null ? '' : `Mat ${line.matNumber}`}</TableCell>
      <TableCell className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          {/* 7.4: the winner is white at 500 and the loser --gray-10 at 400, never --fault. */}
          <span
            className="flex min-w-0 items-center gap-2"
            onMouseEnter={() => onHover(winner.id)}
            onMouseLeave={() => onHover(null)}
          >
            <TeamPlate color={winner.team.color} name={winner.team.name} size="inline" showName={false} />
            <span className="truncate t3 font-medium text-white">{name(winner.id, winner.team)}</span>
          </span>
          {/* 2.1: --gray-9 is decoration only. This is the verb of the row's sentence. */}
          <span className="shrink-0 t2 text-gray-10">beat</span>
          <span
            className="flex min-w-0 items-center gap-2"
            onMouseEnter={() => onHover(loser.id)}
            onMouseLeave={() => onHover(null)}
          >
            <TeamPlate color={loser.team.color} name={loser.team.name} size="inline" showName={false} />
            <span className="truncate t3 text-gray-10">{name(loser.id, loser.team)}</span>
          </span>
        </span>
      </TableCell>
      <TableCell className="w-[160px] t2 text-gray-10">{m.winType ? winTypeLabel(m.winType) : ''}</TableCell>
      <TableCell numeric className="w-[80px] text-gray-10">{endedLabel(line.endedAt)}</TableCell>
    </TableRow>
  )
}

export function MatchesTab({ detail }: { detail: EventDetail }) {
  const eventId = detail.event.id
  // No pinned interval: this tab always mounts inside the event body's stream, which polls
  // on the derived ramp. Pinning one here produced a number the stream ignored and then fed
  // it to the clock as a staleness threshold, so this tab called data fresh for seconds
  // after the board had already stopped trusting it.
  const { snapshot, lastSuccessAt } = useSnapshot(eventId)
  const pollIntervalMs = pollIntervalForSnapshot(snapshot)
  const [pick, setPick] = useState<Pick | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const [showSettled, setShowSettled] = useState(false)
  // Which pending matches this browser has moved by hand, so Regenerate can state what it
  // is about to discard. The server stores an order, not who chose it.
  const [handOrdered, setHandOrdered] = useState<number[]>([])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const lines = useMemo(() => matchLines(detail, snapshot), [detail, snapshot])
  const live = useMemo(() => lines.filter(l => l.lane === 'live'), [lines])
  const pending = useMemo(() => lines.filter(l => l.lane === 'pending'), [lines])
  const settled = useMemo(() => lines.filter(l => l.lane === 'settled'), [lines])
  // Only pending rows are sortable: a live or settled match keeps its exact overall
  // position, so Up/Down and drag only ever swap a pending row with another pending row.
  const pendingIds = useMemo(() => pending.map(l => l.row.id), [pending])
  // The status a row is shown under is the merged one, so the warning agrees with the lane.
  const doubleBooked = useMemo(
    () => doubleBookedMatchIds(lines.map(l => ({ ...l.row, status: l.status }))),
    [lines],
  )

  const generate = useAdminMutation(eventId, () => adminApi<{ created: number; unpairedA: number[]; unpairedB: number[] }>(`/api/events/${eventId}/matches/generate`, { method: 'POST' }))
  const patch = useAdminMutation(eventId, (v: { id: number; body: Partial<MatchRow> }) => adminApi(`/api/matches/${v.id}`, { method: 'PATCH', body: v.body }))
  const del = useAdminMutation(eventId, (id: number) => adminApi(`/api/matches/${id}`, { method: 'DELETE' }))
  const reorder = useAdminMutation(eventId, (next: number[]) => adminApi(`/api/events/${eventId}/matches/reorder`, { method: 'POST', body: { ids: next } }))

  // Only the most recently started action's error stays visible: reset the other
  // three mutations before starting a new one, so a stale failure from an earlier
  // action never lingers behind a later, unrelated success.
  const resetExcept = (keep: 'generate' | 'patch' | 'del' | 'reorder') => {
    if (keep !== 'generate') generate.reset()
    if (keep !== 'patch') patch.reset()
    if (keep !== 'del') del.reset()
    if (keep !== 'reorder') reorder.reset()
  }

  const pendingCount = pendingIds.length
  const hasPending = pendingCount > 0
  const handCount = handOrdered.filter(id => pendingIds.includes(id)).length
  // Refuse rather than ask: Regenerate deletes the whole pending queue, including the
  // rows a running mat is about to call, so it is disabled with the reason printed.
  const blocked = regenerateBlockedReason(live)

  // Every path that closes the confirm dialog (Cancel, backdrop/Escape via
  // onOpenChange, and a successful regenerate) routes through here, so a failed
  // generate's error never outlives the dialog it was shown in.
  const closeConfirm = () => {
    setConfirmOpen(false)
    generate.reset()
  }
  const runGenerate = () => {
    resetExcept('generate')
    generate.mutate(undefined, {
      onSuccess: r => {
        setSummary(`${r.created} matches created. ${r.unpairedA.length + r.unpairedB.length} competitors unpaired.`)
        setHandOrdered([])
        closeConfirm()
      },
    })
  }
  const onGenerateClick = () => {
    if (blocked) return
    if (hasPending) { setConfirmOpen(true); return }
    runGenerate()
  }

  // Moves a pending row within the pending-only subsequence, then rebuilds the full
  // id order for the server with every other row's id back in its original slot.
  const reorderPending = (pendingFrom: number, pendingTo: number): number[] => {
    const movedPending = moveId(pendingIds, pendingFrom, pendingTo)
    let cursor = 0
    return lines.map(l => (l.lane === 'pending' ? movedPending[cursor++] : l.row.id))
  }
  const markHandOrdered = (id: number) => setHandOrdered(s => (s.includes(id) ? s : [...s, id]))
  const onMovePending = (pendingIndex: number, dir: -1 | 1) => {
    const to = pendingIndex + dir
    if (to < 0 || to >= pendingIds.length) return
    resetExcept('reorder')
    markHandOrdered(pendingIds[pendingIndex])
    reorder.mutate(reorderPending(pendingIndex, to))
  }
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(false)
    if (!e.over || e.active.id === e.over.id) return
    const from = pendingIds.indexOf(Number(e.active.id))
    const to = pendingIds.indexOf(Number(e.over.id))
    if (from === -1 || to === -1) return
    resetExcept('reorder')
    markHandOrdered(Number(e.active.id))
    reorder.mutate(reorderPending(from, to))
  }
  const onPicked = (athleteId: number) => {
    if (!pick) return
    resetExcept('patch')
    patch.mutate({ id: pick.matchId, body: pick.side === 'a' ? { athleteAId: athleteId } : { athleteBId: athleteId } })
    setPick(null)
  }
  // onError is how a cell that holds a draft learns its write was refused, so the
  // rejected value never stays on screen looking saved.
  const onPatchAction = (id: number, body: Partial<MatchRow>, onError?: () => void) => {
    resetExcept('patch')
    patch.mutate({ id, body }, onError ? { onError } : undefined)
  }
  const onDeleteAction = (id: number) => {
    resetExcept('del')
    del.mutate(id)
  }

  const [teamA, teamB] = detail.teams
  const byId = useMemo(() => new Map(detail.athletes.map(a => [a.id, a])), [detail.athletes])
  const nameOf: NameOf = (id, team) => {
    const k = byId.get(id)
    return k ? athleteName(k) : `Unpaired, ${team.name}`
  }
  const matItems = useMemo(() => [
    { value: '', label: 'No mat' },
    ...detail.mats.map(mat => ({ value: String(mat.id), label: `Mat ${mat.number}` })),
  ], [detail.mats])
  const rulesetItems = useMemo(() => detail.rulesets.map(r => ({ value: String(r.id), label: r.name })), [detail.rulesets])
  const inMatch = new Set(detail.matches.flatMap(m => [m.athleteAId, m.athleteBId]))
  const unpaired = detail.teams.map(t => ({ team: t, kids: detail.athletes.filter(a => a.teamId === t.id && !inMatch.has(a.id)) }))
  const holds = (line: MatchLine) => hovered !== null && (line.row.athleteAId === hovered || line.row.athleteBId === hovered)

  // While the confirm dialog is open, a failed generate is shown inside the
  // dialog only; the outer banner picks it back up once the dialog is closed
  // (closeConfirm resets it, so a successful or cancelled close leaves nothing).
  const generateError = confirmOpen ? null : generate.error
  const failure = generateError ? { title: 'The matchups did not generate', error: generateError }
    : patch.error ? { title: 'The change did not save', error: patch.error }
      : del.error ? { title: 'The match was not deleted', error: del.error }
        : reorder.error ? { title: 'The new order did not save', error: reorder.error }
          : null

  return (
    // 4.4: the drag contract operatorEngaged() reads. An arriving snapshot is held, not
    // committed, while this is set.
    <div className="grid gap-6" data-dragging={dragging ? 'true' : undefined}>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={onGenerateClick} disabled={generate.isPending || blocked !== null}>
          {hasPending ? 'Regenerate' : 'Generate'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>Add match</Button>
        {blocked && <span className="t2 text-gray-10">{blocked}</span>}
        {/* 7.12: one polite region per screen, in the DOM and empty from the first render. */}
        <span aria-live="polite" className="t2 text-gray-10">{summary ?? ''}</span>
      </div>

      {failure && (
        <Alert>
          <AlertTitle>{failure.title}</AlertTitle>
          <AlertDescription>{failure.error.message}</AlertDescription>
        </Alert>
      )}

      {live.length > 0 && (
        <section aria-label="Live now" className="grid gap-3">
          {live.map(l => (
            <LiveStrip
              key={l.row.id} line={l} teamA={teamA} teamB={teamB}
              nameA={nameOf(l.row.athleteAId, teamA)} nameB={nameOf(l.row.athleteBId, teamB)}
              serverNow={snapshot?.now ?? null} lastSuccessAt={lastSuccessAt} pollIntervalMs={pollIntervalMs}
              highlight={holds(l)} onHover={setHovered}
            />
          ))}
        </section>
      )}

      <Dialog open={confirmOpen} onOpenChange={o => { if (o) setConfirmOpen(true); else closeConfirm() }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Replace {pendingCount} pending {pendingCount === 1 ? 'match' : 'matches'}?</DialogTitle></DialogHeader>
          <DialogBody>
            <p className="t3 text-gray-11">{regenerateWarning(pendingCount, handCount)}</p>
            <p className="t3 text-gray-11">Manually added or edited pending matches are replaced too. Live and done matches are not affected.</p>
            {generate.error && (
              <Alert>
                <AlertTitle>The matchups did not generate</AlertTitle>
                <AlertDescription>{generate.error.message}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" size="lg" variant="secondary" onClick={closeConfirm}>Cancel</Button>
            <Button type="button" size="lg" variant="destructive" disabled={generate.isPending} onClick={runGenerate}>Regenerate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <KidPickerDialog detail={detail} teamId={pick?.teamId ?? null} matchId={pick?.matchId ?? null} open={pick !== null} onOpenChange={o => { if (!o) setPick(null) }} onPick={onPicked} />
      <AddMatchDialog detail={detail} open={addOpen} onOpenChange={setAddOpen} />

      <section aria-label="Pending matches" className="grid gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="t4">Pending</h3>
          <span className="t2 text-gray-10"><span className="fig">{pendingCount}</span> to run</span>
          <span className="ml-auto flex items-center gap-3">
            <TeamPlate color={teamA.color} name={teamA.name} />
            <span className="t1 text-gray-10 uppercase">vs</span>
            <TeamPlate color={teamB.color} name={teamB.name} />
          </span>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setDragging(true)} onDragCancel={() => setDragging(false)} onDragEnd={onDragEnd}>
          <SortableContext items={pendingIds} strategy={verticalListSortingStrategy}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[var(--col-act)] pr-0"><span className="sr-only">Reorder</span></TableHead>
                  <TableHead className="w-[var(--col-state)] p-0"><span className="sr-only">State</span></TableHead>
                  <TableHead numeric className="w-[var(--col-num-s)]"><span className="font-sans">#</span></TableHead>
                  <TableHead className="w-[112px]">Mat</TableHead>
                  <TableHead>Competitors</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead numeric className="w-[var(--col-num-l)]"><span className="font-sans">Sec</span></TableHead>
                  <TableHead className="w-[168px]">Ruleset</TableHead>
                  <TableHead className="w-px"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={PENDING_COLUMNS} className="p-0">
                      <EmptyState
                        message="No matches yet."
                        action={<Button size="sm" variant="ghost" disabled={blocked !== null || generate.isPending} onClick={onGenerateClick}>Generate matchups</Button>}
                      />
                    </TableCell>
                  </TableRow>
                ) : pending.map((l, i) => (
                  <PendingRow
                    key={l.row.id} line={l} teams={detail.teams} name={nameOf}
                    matItems={matItems} rulesetItems={rulesetItems} index={i} count={pending.length}
                    doubleBooked={doubleBooked.has(l.row.id)} highlight={holds(l)} onHover={setHovered}
                    onPick={setPick} onPatch={onPatchAction} onDelete={onDeleteAction} onMove={onMovePending}
                  />
                ))}
              </TableBody>
            </Table>
          </SortableContext>
        </DndContext>
      </section>

      {settled.length > 0 && (
        <section aria-label="Settled matches" className="grid gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="t4">Completed (<span className="fig">{settled.length}</span>)</h3>
            <Button size="sm" variant="ghost" aria-expanded={showSettled} onClick={() => setShowSettled(s => !s)}>
              {showSettled ? 'Hide' : 'Show'}
            </Button>
          </div>
          {/* History gets its own field on the recessed band, so it never shares a lane with work. */}
          {showSettled && (
            <div className="overflow-hidden rounded-lg bg-gray-1">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead numeric className="w-[var(--col-num-s)]"><span className="font-sans">#</span></TableHead>
                    <TableHead className="w-[80px]">Mat</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead className="w-[160px]">Win by</TableHead>
                    <TableHead numeric className="w-[80px]"><span className="font-sans">At</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settled.map(l => (
                    <SettledRow key={l.row.id} line={l} teams={detail.teams} name={nameOf} highlight={holds(l)} onHover={setHovered} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      <section aria-label="Unpaired" className="grid items-start gap-6 md:grid-cols-2">
        {unpaired.map(({ team, kids }) => (
          <div key={team.id} className="grid gap-3">
            <div className="flex items-baseline gap-3">
              <TeamPlate color={team.color} name={team.name} />
              <span className="ml-auto t2 text-gray-10"><span className="fig">{kids.length}</span> unpaired</span>
            </div>
            {kids.length === 0
              ? <span className="t2 text-gray-10">Everyone is paired.</span>
              : (
                <ul className="grid gap-1 sm:grid-cols-2">
                  {kids.map(k => <li key={k.id} className="truncate t3 text-gray-11">{athleteName(k)}</li>)}
                </ul>
              )}
          </div>
        ))}
      </section>
    </div>
  )
}
