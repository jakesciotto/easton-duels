import { useMemo, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVerticalIcon } from 'lucide-react'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail, MatchRow } from '@/lib/types'
import { athleteName } from '@/lib/format'
import { moveId } from '@/lib/reorder'
import { cn } from '@/lib/utils'
import { KidPickerDialog } from './KidPickerDialog'
import { AddMatchDialog } from './AddMatchDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TeamDot } from '@/components/TeamDot'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Pick { matchId: number; side: 'a' | 'b'; teamId: number }

const selCell = 'h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none transition-[color,background-color,box-shadow] duration-150 focus-visible:border-transparent focus-visible:shadow-focus disabled:opacity-50'

function Row({ m, detail, index, pendingIndex, pendingCount, onPick, onPatch, onDelete, onMovePending }: {
  m: MatchRow; detail: EventDetail; index: number; pendingIndex: number; pendingCount: number
  onPick: (p: Pick) => void; onPatch: (id: number, body: Partial<MatchRow>) => void; onDelete: (id: number) => void
  onMovePending: (pendingIndex: number, dir: -1 | 1) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: m.id, disabled: m.status !== 'pending' })
  const [teamA, teamB] = detail.teams
  const byId = new Map(detail.athletes.map(a => [a.id, a]))
  const name = (id: number) => { const k = byId.get(id); return k ? athleteName(k) : 'Unknown' }
  const locked = m.status !== 'pending'

  return (
    <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('border-b border-border', locked && 'text-faint')}>
      <td className="px-2 py-1.5">
        <Button
          type="button" variant="ghost" size="icon" aria-label="Drag to reorder" disabled={locked}
          className="cursor-grab disabled:cursor-not-allowed"
          {...attributes} {...listeners}
        >
          <GripVerticalIcon />
        </Button>
      </td>
      <td className="px-2 py-1.5 font-mono tabular">{index + 1}</td>
      <td className="px-2 py-1.5">
        {locked ? (
          <Badge variant={m.status === 'live' ? 'live' : 'done'}>{m.status}</Badge>
        ) : (
          <select aria-label="Mat" className={selCell} value={m.matId ?? ''} onChange={e => onPatch(m.id, { matId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">none</option>
            {detail.mats.map(mat => <option key={mat.id} value={mat.id}>Mat {mat.number}</option>)}
          </select>
        )}
      </td>
      <td className="px-1 py-1.5">
        <button
          type="button" disabled={locked} onClick={() => onPick({ matchId: m.id, side: 'a', teamId: teamA.id })}
          className="rounded-md px-2 py-1 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:shadow-focus disabled:pointer-events-none"
        >
          <TeamDot color={teamA.color} name={name(m.athleteAId)} />
        </button>
      </td>
      <td className="px-1 py-1.5">
        <button
          type="button" disabled={locked} onClick={() => onPick({ matchId: m.id, side: 'b', teamId: teamB.id })}
          className="rounded-md px-2 py-1 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:shadow-focus disabled:pointer-events-none"
        >
          <TeamDot color={teamB.color} name={name(m.athleteBId)} />
        </button>
      </td>
      <td className="px-2 py-1.5">{m.why && <Badge>{m.why}</Badge>}</td>
      <td className="px-2 py-1.5">
        <input
          aria-label="Length" type="number" min={30} max={1800} disabled={locked} defaultValue={m.lengthSec}
          className="h-8 w-20 rounded-md border border-input bg-card px-2 font-mono tabular text-sm outline-none focus-visible:border-transparent focus-visible:shadow-focus disabled:opacity-50"
          onBlur={e => { const v = Number(e.target.value); if (v !== m.lengthSec && v >= 30 && v <= 1800) onPatch(m.id, { lengthSec: v }) }}
        />
      </td>
      <td className="px-2 py-1.5">
        <select aria-label="Ruleset" disabled={locked} className={selCell} value={m.rulesetId} onChange={e => onPatch(m.id, { rulesetId: Number(e.target.value) })}>
          {detail.rulesets.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5">
        {!locked && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" aria-label="Move up" disabled={pendingIndex === 0} onClick={() => onMovePending(pendingIndex, -1)}>Up</Button>
            <Button size="sm" variant="ghost" aria-label="Move down" disabled={pendingIndex === pendingCount - 1} onClick={() => onMovePending(pendingIndex, 1)}>Down</Button>
            <Button size="sm" variant="ghost" aria-label="Delete match" onClick={() => onDelete(m.id)}>Delete</Button>
          </div>
        )}
      </td>
    </tr>
  )
}

export function MatchesTab({ detail }: { detail: EventDetail }) {
  const eventId = detail.event.id
  const [pick, setPick] = useState<Pick | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const ordered = useMemo(() => [...detail.matches].sort((x, y) => x.orderIndex - y.orderIndex || x.id - y.id), [detail.matches])
  // Only pending rows are sortable: locked (live/done) rows keep their exact overall
  // position, so Up/Down and drag only ever swap a pending row with another pending row.
  const pendingIds = useMemo(() => ordered.filter(m => m.status === 'pending').map(m => m.id), [ordered])

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

  const runGenerate = () => {
    resetExcept('generate')
    generate.mutate(undefined, {
      onSuccess: r => {
        setSummary(`${r.created} matches created. ${r.unpairedA.length + r.unpairedB.length} kids unpaired.`)
        setConfirmOpen(false)
      },
    })
  }
  const onGenerateClick = () => {
    if (hasPending) { setConfirmOpen(true); return }
    runGenerate()
  }

  // Moves a pending row within the pending-only subsequence, then rebuilds the full
  // id order for the server with every locked row's id back in its original slot.
  const reorderPending = (pendingFrom: number, pendingTo: number): number[] => {
    const movedPending = moveId(pendingIds, pendingFrom, pendingTo)
    let cursor = 0
    return ordered.map(m => (m.status === 'pending' ? movedPending[cursor++] : m.id))
  }
  const onMovePending = (pendingIndex: number, dir: -1 | 1) => {
    const to = pendingIndex + dir
    if (to < 0 || to >= pendingIds.length) return
    resetExcept('reorder')
    reorder.mutate(reorderPending(pendingIndex, to))
  }
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = pendingIds.indexOf(Number(e.active.id))
    const to = pendingIds.indexOf(Number(e.over.id))
    if (from === -1 || to === -1) return
    resetExcept('reorder')
    reorder.mutate(reorderPending(from, to))
  }
  const onPicked = (athleteId: number) => {
    if (!pick) return
    resetExcept('patch')
    patch.mutate({ id: pick.matchId, body: pick.side === 'a' ? { athleteAId: athleteId } : { athleteBId: athleteId } })
    setPick(null)
  }
  const onPatchAction = (id: number, body: Partial<MatchRow>) => {
    resetExcept('patch')
    patch.mutate({ id, body })
  }
  const onDeleteAction = (id: number) => {
    resetExcept('del')
    del.mutate(id)
  }

  const inMatch = new Set(detail.matches.flatMap(m => [m.athleteAId, m.athleteBId]))
  const unpaired = detail.teams.map(t => ({ team: t, kids: detail.athletes.filter(a => a.teamId === t.id && !inMatch.has(a.id)) }))
  const error = generate.error ?? patch.error ?? del.error ?? reorder.error

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onGenerateClick} disabled={generate.isPending}>{hasPending ? 'Regenerate' : 'Generate'}</Button>
        <Button variant="secondary" onClick={() => setAddOpen(true)}>Add match</Button>
        {summary && <span aria-live="polite" className="text-[13px] text-faint">{summary}</span>}
        {error && <p role="alert" className="text-[13px] text-destructive">{error.message}</p>}
      </div>
      <Dialog open={confirmOpen} onOpenChange={o => { setConfirmOpen(o); if (!o) generate.reset() }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Replace {pendingCount} pending {pendingCount === 1 ? 'match' : 'matches'}?</DialogTitle></DialogHeader>
          <DialogBody>
            <p className="text-sm text-soft">Manually added or edited pending matches are replaced too. Live and done matches are not affected.</p>
            {generate.error && <p role="alert" className="text-[13px] text-destructive">{generate.error.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={generate.isPending} onClick={runGenerate}>Regenerate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <KidPickerDialog detail={detail} teamId={pick?.teamId ?? null} open={pick !== null} onOpenChange={o => { if (!o) setPick(null) }} onPick={onPicked} />
      <AddMatchDialog detail={detail} open={addOpen} onOpenChange={setAddOpen} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={pendingIds} strategy={verticalListSortingStrategy}>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-2"></th>
                  <th className="label px-2 py-2">#</th>
                  <th className="label px-2 py-2">Mat</th>
                  <th className="label px-1 py-2">{detail.teams[0].name}</th>
                  <th className="label px-1 py-2">{detail.teams[1].name}</th>
                  <th className="label px-2 py-2">Why</th>
                  <th className="label px-2 py-2">Length</th>
                  <th className="label px-2 py-2">Ruleset</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {ordered.length === 0 ? (
                  <tr><td colSpan={9} className="px-2 py-4 text-center text-[13px] text-faint">No matches yet</td></tr>
                ) : ordered.map((m, i) => (
                  <Row
                    key={m.id} m={m} detail={detail} index={i}
                    pendingIndex={pendingIds.indexOf(m.id)} pendingCount={pendingIds.length}
                    onPick={setPick} onPatch={onPatchAction} onDelete={onDeleteAction} onMovePending={onMovePending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </SortableContext>
      </DndContext>
      <section aria-label="Unpaired" className="grid gap-3 md:grid-cols-2">
        {unpaired.map(({ team, kids }) => (
          <div key={team.id} className="rounded-lg border border-border bg-card p-3 text-sm">
            <div className="mb-1.5 flex items-center gap-2">
              <TeamDot color={team.color} name={team.name} />
              <span className="font-mono tabular text-faint">{kids.length}</span>
              <span className="text-faint">unpaired</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {kids.length === 0
                ? <span className="text-[13px] text-faint">Everyone is paired</span>
                : kids.map(k => <Badge key={k.id}>{athleteName(k)}</Badge>)}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
