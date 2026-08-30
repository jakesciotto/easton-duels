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

interface Pick { matchId: number; side: 'a' | 'b'; teamId: number }

const selCell = 'h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none transition-[color,background-color,box-shadow] duration-150 focus-visible:border-transparent focus-visible:shadow-focus disabled:opacity-50'

function Row({ m, detail, index, count, onPick, onPatch, onDelete, onMove }: {
  m: MatchRow; detail: EventDetail; index: number; count: number
  onPick: (p: Pick) => void; onPatch: (id: number, body: Partial<MatchRow>) => void; onDelete: (id: number) => void; onMove: (from: number, to: number) => void
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
          onBlur={e => { const v = Number(e.target.value); if (v !== m.lengthSec && v >= 30) onPatch(m.id, { lengthSec: v }) }}
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
            <Button size="sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => onMove(index, index - 1)}>Up</Button>
            <Button size="sm" variant="ghost" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>Down</Button>
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
  const [summary, setSummary] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const ordered = useMemo(() => [...detail.matches].sort((x, y) => x.orderIndex - y.orderIndex || x.id - y.id), [detail.matches])
  const ids = ordered.map(m => m.id)

  const generate = useAdminMutation(eventId, () => adminApi<{ created: number; unpairedA: number[]; unpairedB: number[] }>(`/api/events/${eventId}/matches/generate`, { method: 'POST' }))
  const patch = useAdminMutation(eventId, (v: { id: number; body: Partial<MatchRow> }) => adminApi(`/api/matches/${v.id}`, { method: 'PATCH', body: v.body }))
  const del = useAdminMutation(eventId, (id: number) => adminApi(`/api/matches/${id}`, { method: 'DELETE' }))
  const reorder = useAdminMutation(eventId, (next: number[]) => adminApi(`/api/events/${eventId}/matches/reorder`, { method: 'POST', body: { ids: next } }))

  const onGenerate = () => {
    generate.mutate(undefined, {
      onSuccess: r => setSummary(`${r.created} matches created. ${r.unpairedA.length + r.unpairedB.length} kids unpaired.`),
    })
  }
  const onMove = (from: number, to: number) => reorder.mutate(moveId(ids, from, to))
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    onMove(ids.indexOf(Number(e.active.id)), ids.indexOf(Number(e.over.id)))
  }
  const onPicked = (athleteId: number) => {
    if (!pick) return
    patch.mutate({ id: pick.matchId, body: pick.side === 'a' ? { athleteAId: athleteId } : { athleteBId: athleteId } })
    setPick(null)
  }

  const inMatch = new Set(detail.matches.flatMap(m => [m.athleteAId, m.athleteBId]))
  const unpaired = detail.teams.map(t => ({ team: t, kids: detail.athletes.filter(a => a.teamId === t.id && !inMatch.has(a.id)) }))
  const hasPending = detail.matches.some(m => m.status === 'pending')
  const error = generate.error ?? patch.error ?? del.error ?? reorder.error

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onGenerate} disabled={generate.isPending}>{hasPending ? 'Regenerate' : 'Generate'}</Button>
        <Button variant="secondary" onClick={() => setAddOpen(true)}>Add match</Button>
        {summary && <span aria-live="polite" className="text-[13px] text-faint">{summary}</span>}
        {error && <p role="alert" className="text-[13px] text-destructive">{error.message}</p>}
      </div>
      <KidPickerDialog detail={detail} teamId={pick?.teamId ?? null} open={pick !== null} onOpenChange={o => { if (!o) setPick(null) }} onPick={onPicked} />
      <AddMatchDialog detail={detail} open={addOpen} onOpenChange={setAddOpen} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
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
                  <Row key={m.id} m={m} detail={detail} index={i} count={ordered.length} onPick={setPick}
                    onPatch={(id, body) => patch.mutate({ id, body })} onDelete={id => del.mutate(id)} onMove={onMove} />
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
