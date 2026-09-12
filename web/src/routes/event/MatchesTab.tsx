import { useMemo, useState } from 'react'
import type { MatchView } from '@shared/types'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVerticalIcon } from 'lucide-react'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { useSnapshot } from '@/lib/useSnapshot'
import { pollIntervalForSnapshot } from '@/lib/pollInterval'
import { CERTIFIED_REFUSAL, modeOf, statusOf, writeErrorMessage } from '@/lib/eventMode'
import type { EventDetail, MatchRow, TeamRow } from '@/lib/types'
import { athleteName, winTypeLabel } from '@/lib/format'
import { moveId } from '@/lib/reorder'
import { doubleBookedMatchIds } from '@/lib/doubleBooking'
import { matchViewOf } from '@/lib/matchView'
import { cn } from '@/lib/utils'
import { KidPickerDialog } from './KidPickerDialog'
import { MatchHistorySheet } from './MatchHistorySheet'
import { matchHistorySource, type HistorySource } from './match-history'
import { ResultDialog } from './ResultDialog'
import { AddMatchDialog } from './AddMatchDialog'
import { ProposalsPanel } from './ProposalsPanel'
import {
  endedLabel, liveReason, matchLabel, matchLines, readyNote, skipNote, type MatchLine,
} from './matches-view'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { OverflowMenu } from '@/components/OverflowMenu'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldRow, FieldSet } from '@/components/ui/field-set'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Clock } from '@/components/Clock'
import { TeamPlate } from '@/components/TeamPlate'

// Which slot a swap is filling: the team the competitor staying in is on, so the picker
// can offer everybody else, and who holds the slot now.
interface Pick { matchId: number; side: 'a' | 'b'; exclude: number; held: number }

// 4.4 names 2000ms for this tab. The suspension that keeps an arriving snapshot off the
// screen while the operator is dragging, typing or picking lives in useSnapshot.

// The length column is absent in desk mode, where nothing runs a clock.
const pendingColumns = (entryMode: boolean) => (entryMode ? 8 : 9)

// The hovered competitor lights every row they appear in. Scanning for one child's next
// bout is the most common thing this screen is used for, and the table is too tall to
// read at once.
type Hover = (athleteId: number | null) => void

/**
 * One competitor of a pairing: the name, and the team that competitor is actually on.
 *
 * An event holds up to eight teams, so a side's colour can no longer be read off the
 * column it sits in. It comes off the roster row, and a competitor the roster no longer
 * carries reads as unknown rather than borrowing somebody else's colour.
 */
interface Side { name: string; team: TeamRow | undefined }
type SideOf = (athleteId: number) => Side

interface Option { value: string; label: string }

// A hand designed pair is never refused, so the server reports what it noticed instead.
interface PatchResult { warnings?: string[] }

// 7.1: the side itself is the swap control. One Swap button on the row could not say
// which of the two competitors it replaces, and the organizer is already pointing at the
// one they want changed.
function CompetitorLine({ side, disabled = false, title, onHover, onPick }: {
  side: Side
  disabled?: boolean
  title?: string
  onHover: (on: boolean) => void
  onPick: () => void
}) {
  const { name, team } = side
  return (
    <button
      type="button"
      aria-label={`Swap ${name}, ${team?.name ?? 'no team'}`}
      title={title ?? 'Swap'}
      disabled={disabled}
      onClick={onPick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className="-mx-2 flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none transition-colors duration-150 ease-standard hover:bg-gray-3 focus-visible:shadow-focus active:bg-gray-4 disabled:pointer-events-none disabled:opacity-50"
    >
      {team && <TeamPlate color={team.color} name={team.name} size="inline" showName={false} />}
      <span className="truncate t3">{name}</span>
    </button>
  )
}

// The live match is not one of forty identical rows. It is lifted into its own strip at
// t5, and it is where "refuse rather than ask" is visible: the controls that would touch
// a running match are disabled with the reason printed beside them.
function LiveStrip({ line, a, b, serverNow, lastSuccessAt, pollIntervalMs, highlight, onHover }: {
  line: MatchLine
  a: Side
  b: Side
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
          {a.team && <TeamPlate color={a.team.color} name={a.team.name} size="inline" showName={false} />}
          <span className="truncate">{a.name}</span>
        </span>
        <span className="t1 text-gray-10 uppercase">vs</span>
        <span className="flex min-w-0 items-center gap-2" onMouseEnter={() => onHover(line.row.athleteBId)} onMouseLeave={() => onHover(null)}>
          {b.team && <TeamPlate color={b.team.color} name={b.team.name} size="inline" showName={false} />}
          <span className="truncate">{b.name}</span>
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="t2 text-gray-10">{reason}</span>
        <Button
          size="sm" variant="destructive" title={reason} disabled
          aria-label={`Delete ${matchLabel(line.position, a.name, b.name)}`}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

/**
 * Controlled, because React writes a `defaultValue` once at mount and never again: a
 * length another operator changed never reached this cell, and the operator set a mat
 * clock from a number the model had already replaced. The draft is
 * dropped whenever the served value moves and whenever a write is refused, so a value
 * on screen is either the served one or one the operator is still typing.
 */
function LengthCell({ label, value, disabled = false, title, onSave }: {
  label: string
  value: number
  disabled?: boolean
  title?: string
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
      disabled={disabled}
      title={title}
      value={draft ?? String(value)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      className="fig fig-4 h-8 w-full rounded-md bg-transparent px-3 text-right outline-none transition-colors duration-150 ease-standard hover:bg-gray-3 focus-visible:bg-gray-3 focus-visible:shadow-focus disabled:opacity-50"
    />
  )
}

function PendingRow({ line, sideOf, warnings, matItems, rulesetItems, index, count, doubleBooked, entryMode, certified, highlight, onHover, onPick, onPatch, onDelete, onMove }: {
  line: MatchLine
  sideOf: SideOf
  /** What the server said about the pair the last swap on this row produced. */
  warnings: string[]
  matItems: Option[]
  rulesetItems: Option[]
  index: number
  count: number
  doubleBooked: boolean
  entryMode: boolean
  /** 6.8: a certified event refuses rather than asks, so every control here is dead. */
  certified: boolean
  highlight: boolean
  onHover: Hover
  onPick: (p: Pick) => void
  onPatch: (id: number, body: Partial<MatchRow>, onError?: () => void) => void
  onDelete: (id: number) => void
  onMove: (index: number, dir: -1 | 1) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: line.row.id })
  const m = line.row
  const a = sideOf(m.athleteAId)
  const b = sideOf(m.athleteBId)
  const attend = doubleBooked || line.state === 'skipped'
  const ready = line.state === 'ready' ? readyNote(line) : null
  // Every control below is otherwise named the same on all fourteen rows.
  const row = matchLabel(line.position, a.name, b.name)

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
          className={certified ? undefined : 'cursor-grab'}
          disabled={certified} title={certified ? CERTIFIED_REFUSAL : undefined}
          {...(certified ? {} : attributes)} {...(certified ? {} : listeners)}
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
          <SelectTrigger size="sm" aria-label={`Mat for ${row}`} disabled={certified} title={certified ? CERTIFIED_REFUSAL : undefined}><SelectValue /></SelectTrigger>
          <SelectContent>
            {matItems.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="min-w-0">
        <div className="grid min-w-0">
          <CompetitorLine
            side={a} disabled={certified || b.team === undefined} title={certified ? CERTIFIED_REFUSAL : undefined}
            onHover={on => onHover(on ? m.athleteAId : null)}
            onPick={() => { if (b.team) onPick({ matchId: m.id, side: 'a', exclude: b.team.id, held: m.athleteAId }) }}
          />
          <CompetitorLine
            side={b} disabled={certified || a.team === undefined} title={certified ? CERTIFIED_REFUSAL : undefined}
            onHover={on => onHover(on ? m.athleteBId : null)}
            onPick={() => { if (a.team) onPick({ matchId: m.id, side: 'b', exclude: a.team.id, held: m.athleteBId }) }}
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
            {/* A swap never blocks, so what the server noticed about the new pair is
                reported on the row it changed, the picker that made it having closed. */}
            {warnings.map(w => <span key={w} className="t2 text-attend">{w}</span>)}
            {ready && <span className="t2 text-gray-10">{ready}</span>}
          </span>
        </div>
      </TableCell>
      {/*
        An editable cell rather than a boxed input: the length is a figure on the Ledger
        Grid's own track, and a boxed control cannot hold 4ch plus its own border inside it.
        Never type="number" (7.8): the spinner steals the track and the scroll wheel.

        Absent in desk mode. No clock ever starts there, so the cell is a number the
        organizer can set and nothing will ever read.
      */}
      {!entryMode && (
        <TableCell numeric className="w-[var(--col-num-l)] p-0">
          <LengthCell
            label={`Length for ${row}`}
            value={m.lengthSec}
            disabled={certified}
            title={certified ? CERTIFIED_REFUSAL : undefined}
            onSave={(lengthSec, onRefused) => onPatch(m.id, { lengthSec }, onRefused)}
          />
        </TableCell>
      )}
      <TableCell className="w-[168px]">
        <Select
          value={String(m.rulesetId)}
          onValueChange={v => { const next = String(v ?? ''); if (next) onPatch(m.id, { rulesetId: Number(next) }) }}
          items={rulesetItems}
        >
          <SelectTrigger size="sm" aria-label={`Ruleset for ${row}`} disabled={certified} title={certified ? CERTIFIED_REFUSAL : undefined}><SelectValue /></SelectTrigger>
          <SelectContent>
            {rulesetItems.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="w-px whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" aria-label={`Move ${row} up`} title={certified ? CERTIFIED_REFUSAL : undefined} disabled={certified || index === 0} onClick={() => onMove(index, -1)}>Up</Button>
          <Button size="sm" variant="ghost" aria-label={`Move ${row} down`} title={certified ? CERTIFIED_REFUSAL : undefined} disabled={certified || index === count - 1} onClick={() => onMove(index, 1)}>Down</Button>
          {/* A pairing has two sides, so Swap has to say which one it is replacing. The
              competitor lines are the shortcut; this is the labelled control. */}
          <OverflowMenu
            label={`Swap in ${row}`}
            text="Swap"
            disabled={certified}
            items={[
              { key: 'a', label: `Swap ${a.name}`, disabled: b.team === undefined, onSelect: () => { if (b.team) onPick({ matchId: m.id, side: 'a', exclude: b.team.id, held: m.athleteAId }) } },
              { key: 'b', label: `Swap ${b.name}`, disabled: a.team === undefined, onSelect: () => { if (a.team) onPick({ matchId: m.id, side: 'b', exclude: a.team.id, held: m.athleteBId }) } },
            ]}
          />
          {/* 7.7: a destructive control never sits flush against the row's most repeated one. */}
          <Button size="sm" variant="destructive" className="ml-4" aria-label={`Delete ${row}`} title={certified ? CERTIFIED_REFUSAL : undefined} disabled={certified} onClick={() => onDelete(m.id)}>Delete</Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function SettledRow({ line, sideOf, highlight, certified, onHover, onHistory, onEdit }: {
  line: MatchLine
  sideOf: SideOf
  highlight: boolean
  /** Refuse rather than ask (6.8): a certified record cannot be corrected from here. */
  certified: boolean
  onHover: Hover
  onHistory: () => void
  onEdit: () => void
}) {
  const m = line.row
  const aWon = m.winnerAthleteId === m.athleteAId
  const winnerId = aWon ? m.athleteAId : m.athleteBId
  const loserId = aWon ? m.athleteBId : m.athleteAId
  const winner = sideOf(winnerId)
  const loser = sideOf(loserId)

  return (
    <TableRow data-match-state="done" selected={highlight}>
      <TableCell numeric className="w-[var(--col-num-s)] text-gray-10">{line.position}</TableCell>
      <TableCell className="w-[80px] t2 text-gray-10">{line.matNumber === null ? '' : `Mat ${line.matNumber}`}</TableCell>
      <TableCell className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          {/* 7.4: the winner is white at 500 and the loser --gray-10 at 400, never --fault. */}
          <span
            className="flex min-w-0 items-center gap-2"
            onMouseEnter={() => onHover(winnerId)}
            onMouseLeave={() => onHover(null)}
          >
            {winner.team && <TeamPlate color={winner.team.color} name={winner.team.name} size="inline" showName={false} />}
            <span className="truncate t3 font-medium text-white">{winner.name}</span>
          </span>
          {/* 2.1: --gray-9 is decoration only. This is the verb of the row's sentence. */}
          <span className="shrink-0 t2 text-gray-10">beat</span>
          <span
            className="flex min-w-0 items-center gap-2"
            onMouseEnter={() => onHover(loserId)}
            onMouseLeave={() => onHover(null)}
          >
            {loser.team && <TeamPlate color={loser.team.color} name={loser.team.name} size="inline" showName={false} />}
            <span className="truncate t3 text-gray-10">{loser.name}</span>
          </span>
        </span>
      </TableCell>
      <TableCell className="w-[160px] t2 text-gray-10">{m.winType ? winTypeLabel(m.winType) : ''}</TableCell>
      <TableCell numeric className="w-[80px] text-gray-10">{endedLabel(line.endedAt)}</TableCell>
      <TableCell className="w-px pl-0">
        <OverflowMenu
          label={`${matchLabel(line.position, sideOf(m.athleteAId).name, sideOf(m.athleteBId).name)} actions`}
          items={[
            { key: 'history', label: 'Match history', disabled: false, onSelect: onHistory },
            { key: 'edit', label: 'Edit result', disabled: certified, onSelect: onEdit },
          ]}
        />
      </TableCell>
    </TableRow>
  )
}

export function MatchesTab({ detail }: { detail: EventDetail }) {
  const eventId = detail.event.id
  // No pinned interval: this tab always mounts inside the event body's stream, which polls
  // on the derived ramp. Pinning one here produced a number the stream ignored and then fed
  // it to the clock as a staleness threshold, so this tab called data fresh for seconds
  // after the board had already stopped trusting it.
  const { snapshot, live: liveSnapshot, lastSuccessAt } = useSnapshot(eventId)
  const pollIntervalMs = pollIntervalForSnapshot(snapshot)
  // The room's own account of how the event runs, not this browser's detail cache: the
  // organizer switches the event from a phone at the same desk and nothing invalidates
  // the cache when they do.
  const entryMode = modeOf(liveSnapshot, detail.event.mode) === 'entry'
  const certified = statusOf(liveSnapshot, detail.event.status) === 'certified'
  const [pick, setPick] = useState<Pick | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  // The competitor the Add match dialog opens on, when it was opened from a row that
  // names one. Null when it was opened from the toolbar.
  const [addStart, setAddStart] = useState<number | null>(null)
  // What the server said about each pair a swap on this tab produced, by match. A warning
  // never blocks the write, so it is reported on the row rather than in a refusal.
  const [swapNotes, setSwapNotes] = useState<Record<number, string[]>>({})
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const [showSettled, setShowSettled] = useState(false)
  const [history, setHistory] = useState<HistorySource | null>(null)
  const [editing, setEditing] = useState<MatchView | null>(null)
  // A certified event has no sensor at all, so a drag cannot start. Disabling the handle
  // alone would still let a pointer press land on the row and begin one.
  const pointer = useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  const sensors = useSensors(...(certified ? [] : [pointer]))

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

  const patch = useAdminMutation(eventId, (v: { id: number; body: Partial<MatchRow> }) => adminApi<PatchResult>(`/api/matches/${v.id}`, { method: 'PATCH', body: v.body }))
  const del = useAdminMutation(eventId, (id: number) => adminApi(`/api/matches/${id}`, { method: 'DELETE' }))
  const reorder = useAdminMutation(eventId, (next: number[]) => adminApi(`/api/events/${eventId}/matches/reorder`, { method: 'POST', body: { ids: next } }))

  // Only the most recently started action's error stays visible: reset the other
  // two mutations before starting a new one, so a stale failure from an earlier
  // action never lingers behind a later, unrelated success.
  const resetExcept = (keep: 'patch' | 'del' | 'reorder') => {
    if (keep !== 'patch') patch.reset()
    if (keep !== 'del') del.reset()
    if (keep !== 'reorder') reorder.reset()
  }

  const pendingCount = pendingIds.length

  // Moves a pending row within the pending-only subsequence, then rebuilds the full
  // id order for the server with every other row's id back in its original slot.
  const reorderPending = (pendingFrom: number, pendingTo: number): number[] => {
    const movedPending = moveId(pendingIds, pendingFrom, pendingTo)
    let cursor = 0
    return lines.map(l => (l.lane === 'pending' ? movedPending[cursor++] : l.row.id))
  }
  const onMovePending = (pendingIndex: number, dir: -1 | 1) => {
    const to = pendingIndex + dir
    if (to < 0 || to >= pendingIds.length) return
    resetExcept('reorder')
    reorder.mutate(reorderPending(pendingIndex, to))
  }
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(false)
    if (!e.over || e.active.id === e.over.id) return
    const from = pendingIds.indexOf(Number(e.active.id))
    const to = pendingIds.indexOf(Number(e.over.id))
    if (from === -1 || to === -1) return
    resetExcept('reorder')
    reorder.mutate(reorderPending(from, to))
  }
  const onPicked = (athleteId: number) => {
    if (!pick) return
    const { matchId, side } = pick
    resetExcept('patch')
    patch.mutate(
      { id: matchId, body: side === 'a' ? { athleteAId: athleteId } : { athleteBId: athleteId } },
      { onSuccess: r => setSwapNotes(n => ({ ...n, [matchId]: r?.warnings ?? [] })) },
    )
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

  const byId = useMemo(() => new Map(detail.athletes.map(a => [a.id, a])), [detail.athletes])
  const teamById = useMemo(() => new Map(detail.teams.map(t => [t.id, t])), [detail.teams])
  const sideOf: SideOf = id => {
    const k = byId.get(id)
    if (!k) return { name: 'Unknown competitor', team: undefined }
    return { name: athleteName(k), team: k.teamId === null ? undefined : teamById.get(k.teamId) }
  }
  const matItems = useMemo(() => [
    { value: '', label: 'No mat' },
    ...detail.mats.map(mat => ({ value: String(mat.id), label: `Mat ${mat.number}` })),
  ], [detail.mats])
  const rulesetItems = useMemo(() => detail.rulesets.map(r => ({ value: String(r.id), label: r.name })), [detail.rulesets])
  // Spec 6's "Without a match": a competitor in a pending or a live match is busy, and
  // one whose matches have all settled is free to be paired again.
  const booked = new Set(detail.matches.filter(m => m.status === 'pending' || m.status === 'live').flatMap(m => [m.athleteAId, m.athleteBId]))
  const free = detail.teams.map(t => ({ team: t, kids: detail.athletes.filter(a => a.teamId === t.id && !booked.has(a.id)) }))
  const openAdd = (startId: number | null) => { setAddStart(startId); setAddOpen(true) }
  const holds = (line: MatchLine) => hovered !== null && (line.row.athleteAId === hovered || line.row.athleteBId === hovered)
  const viewOf = (line: MatchLine) => matchViewOf(line.row, detail, snapshot)

  const failure = patch.error ? { title: 'The change did not save', error: patch.error }
    : del.error ? { title: 'The match was not deleted', error: del.error }
      : reorder.error ? { title: 'The new order did not save', error: reorder.error }
        : null

  return (
    // 4.4: the drag contract operatorEngaged() reads. An arriving snapshot is held, not
    // committed, while this is set.
    <div className="grid gap-6" data-dragging={dragging ? 'true' : undefined}>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" disabled={certified} onClick={() => openAdd(null)}>Add match</Button>
        {/* 6.8: the reason a control is dead is printed once, beside the controls it kills,
            rather than waiting for somebody to press one and read a banner. */}
        {certified && <span className="t2 text-gray-10">{CERTIFIED_REFUSAL}</span>}
      </div>

      {failure && (
        <Alert>
          <AlertTitle>{failure.title}</AlertTitle>
          <AlertDescription>{writeErrorMessage(failure.error)}</AlertDescription>
        </Alert>
      )}

      {/* In desk mode nothing starts a match, so this strip is normally empty there. The one
          exception is a switch to the desk taken mid-bout: that match stays live on its mat
          until the desk types its result, and hiding it here hid the only list that named it. */}
      {live.length > 0 && (
        <section aria-label="Live now" className="grid gap-3">
          {live.map(l => (
            <LiveStrip
              key={l.row.id} line={l} a={sideOf(l.row.athleteAId)} b={sideOf(l.row.athleteBId)}
              serverNow={snapshot?.now ?? null} lastSuccessAt={lastSuccessAt} pollIntervalMs={pollIntervalMs}
              highlight={holds(l)} onHover={setHovered}
            />
          ))}
        </section>
      )}

      <KidPickerDialog
        detail={detail}
        exclude={pick?.exclude ?? null}
        held={pick?.held ?? null}
        matchId={pick?.matchId ?? null}
        open={pick !== null}
        onOpenChange={o => { if (!o) setPick(null) }}
        onPick={onPicked}
      />
      <AddMatchDialog detail={detail} start={addStart} open={addOpen} onOpenChange={setAddOpen} />
      {/* The one correction dialog, reached from the settled field as well as from the
          Live tab's panel overflow and the Entry tab's ledger. */}
      <ResultDialog detail={detail} match={editing} open={editing !== null} onOpenChange={o => { if (!o) setEditing(null) }} />
      <MatchHistorySheet source={history} open={history !== null} onOpenChange={o => { if (!o) setHistory(null) }} />

      {/* Spec 6: the drafts sit above the running order, because confirming one is what
          puts a row into it. */}
      <ProposalsPanel detail={detail} certified={certified} />

      <section aria-label="Pending matches" className="grid gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="t4">Pending</h3>
          <span className="t2 text-gray-10"><span className="fig">{pendingCount}</span> to run</span>
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
                  {!entryMode && <TableHead numeric className="w-[var(--col-num-l)]"><span className="font-sans">Sec</span></TableHead>}
                  <TableHead className="w-[168px]">Ruleset</TableHead>
                  <TableHead className="w-px"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={pendingColumns(entryMode)} className="p-0">
                      <EmptyState
                        message="No matches yet."
                        action={<Button size="sm" variant="ghost" disabled={certified} onClick={() => openAdd(null)}>Add match</Button>}
                      />
                    </TableCell>
                  </TableRow>
                ) : pending.map((l, i) => (
                  <PendingRow
                    key={l.row.id} line={l} sideOf={sideOf} warnings={swapNotes[l.row.id] ?? []}
                    matItems={matItems} rulesetItems={rulesetItems} index={i} count={pending.length}
                    doubleBooked={doubleBooked.has(l.row.id)} entryMode={entryMode} certified={certified}
                    highlight={holds(l)} onHover={setHovered}
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
                    <TableHead className="w-px"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settled.map(l => (
                    <SettledRow
                      key={l.row.id} line={l} sideOf={sideOf}
                      highlight={holds(l)} certified={certified} onHover={setHovered}
                      onHistory={() => setHistory(matchHistorySource(viewOf(l), l.matNumber, detail))}
                      onEdit={() => setEditing(viewOf(l))}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      <section aria-label="Without a match" className="grid gap-3">
        <h3 className="t4">Without a match</h3>
        <div className="grid items-start gap-6 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
          {free.map(({ team, kids }) => (
            <div key={team.id} className="grid min-w-0 gap-3">
              <div className="flex items-baseline gap-3">
                <TeamPlate color={team.color} name={team.name} />
                <span className="ml-auto fig t2 text-gray-10">{kids.length}</span>
              </div>
              <FieldSet>
                {kids.length === 0
                  ? <EmptyState message="Everybody here has a match." />
                  : (
                    <div role="list">
                      {kids.map(k => (
                        <FieldRow key={k.id} role="listitem" className="flex h-10 gap-3">
                          <span className="min-w-0 flex-1 truncate t3 text-gray-11">{athleteName(k)}</span>
                          <Button
                            size="sm" variant="ghost" aria-label={`Add match for ${athleteName(k)}`}
                            title={certified ? CERTIFIED_REFUSAL : undefined} disabled={certified}
                            onClick={() => openAdd(k.id)}
                          >
                            Add match
                          </Button>
                        </FieldRow>
                      ))}
                    </div>
                  )}
              </FieldSet>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
