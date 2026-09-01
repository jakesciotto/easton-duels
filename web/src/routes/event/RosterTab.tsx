import { useRef, useState } from 'react'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { AthleteRow, EventDetail } from '@/lib/types'
import { athleteName } from '@/lib/format'
import { AddKidDialog } from './AddKidDialog'
import { PasteRosterDialog } from './PasteRosterDialog'
import { SyncRosterDialog } from './SyncRosterDialog'
import { RosterGroup } from './roster-group'
import { dropZoneValue, useRosterDrag } from './roster-drag'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function RosterTab({ detail }: { detail: EventDetail }) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [faults, setFaults] = useState<Set<number>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [removing, setRemoving] = useState<AthleteRow[]>([])
  const anchor = useRef<number | null>(null)
  const eventId = detail.event.id
  const assign = useAdminMutation(eventId, (v: { ids: number[]; teamId: number | null }) => adminApi(`/api/events/${eventId}/athletes/assign`, { method: 'POST', body: v }))
  const patch = useAdminMutation(eventId, (v: { id: number; body: Partial<AthleteRow> }) => adminApi(`/api/athletes/${v.id}`, { method: 'PATCH', body: v.body }))
  const remove = useAdminMutation(eventId, (id: number) => adminApi(`/api/athletes/${id}`, { method: 'DELETE' }))

  const byTeam = (teamId: number | null) => detail.athletes.filter(a => a.teamId === teamId).sort((x, y) => x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName))
  const [teamA, teamB] = detail.teams
  const groups = [
    { key: 'a', title: teamA.name, color: teamA.color, teamId: teamA.id as number | null, kids: byTeam(teamA.id) },
    { key: 'u', title: 'Unassigned', color: null, teamId: null as number | null, kids: byTeam(null) },
    { key: 'b', title: teamB.name, color: teamB.color, teamId: teamB.id as number | null, kids: byTeam(teamB.id) },
  ]
  // Reading order, which is also the order a shift-click range walks.
  const order = groups.flatMap(g => g.kids.map(k => k.id))

  const onSelect = (id: number, v: boolean, range: boolean) => {
    const from = anchor.current
    anchor.current = id
    setSelected(s => {
      const n = new Set(s)
      const start = from === null ? -1 : order.indexOf(from)
      const end = order.indexOf(id)
      if (range && start !== -1 && end !== -1) {
        for (const rid of order.slice(Math.min(start, end), Math.max(start, end) + 1)) {
          if (v) n.add(rid)
          else n.delete(rid)
        }
        return n
      }
      if (v) n.add(id)
      else n.delete(id)
      return n
    })
  }

  const clearSelection = () => setSelected(new Set())
  const moveTo = (ids: number[], teamId: number | null) => {
    const moving = ids.filter(id => detail.athletes.find(a => a.id === id)?.teamId !== teamId)
    if (moving.length === 0) {
      clearSelection()
      return
    }
    assign.mutate({ ids: moving, teamId }, { onSuccess: clearSelection })
  }

  const onPatch = (id: number, body: Partial<AthleteRow>) => patch.mutate({ id, body }, {
    // A refused write is the row's own state, not a banner the organizer has to
    // match back to a name, so the state rule carries it until the row saves.
    onError: () => setFaults(f => new Set(f).add(id)),
    onSuccess: () => setFaults(f => {
      if (!f.has(id)) return f
      const n = new Set(f)
      n.delete(id)
      return n
    }),
  })

  const drag = useRosterDrag((id, teamId) => moveTo([id], teamId))

  // Cancel, the backdrop, Escape, and a successful remove all close through here,
  // so a failed remove's message never outlives the dialog it was shown in.
  const closeRemove = () => {
    setRemoving([])
    remove.reset()
  }
  const runRemove = async () => {
    const done: number[] = []
    for (const kid of removing) {
      try {
        await remove.mutateAsync(kid.id)
        done.push(kid.id)
      } catch {
        break
      }
    }
    if (done.length > 0) {
      setSelected(s => {
        const n = new Set(s)
        for (const id of done) n.delete(id)
        return n
      })
    }
    if (done.length === removing.length) closeRemove()
    else setRemoving(removing.filter(k => !done.includes(k.id)))
  }

  const selectedRows = detail.athletes.filter(a => selected.has(a.id))
  const needsData = detail.athletes.filter(a => a.age === null || a.weightLbs === null).length
  const failure = assign.error ?? patch.error

  return (
    <div className="grid gap-6" data-dragging={drag.dragging}>
      {selected.size > 0 ? (
        <div role="group" aria-label="Selection" className="flex min-h-10 flex-wrap items-center gap-3">
          <span className="t3 font-medium!"><span className="fig">{selected.size}</span> selected</span>
          <Button size="sm" variant="secondary" onClick={() => moveTo([...selected], teamA.id)}>Move to {teamA.name}</Button>
          <Button size="sm" variant="secondary" onClick={() => moveTo([...selected], teamB.id)}>Move to {teamB.name}</Button>
          <Button size="sm" variant="secondary" onClick={() => moveTo([...selected], null)}>Move to Unassigned</Button>
          <Button size="sm" variant="ghost" onClick={() => setRemoving(selectedRows)}>Remove</Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
        </div>
      ) : (
        <div className="flex min-h-10 flex-wrap items-center gap-2">
          <span className="t2 text-gray-10">
            {detail.teams.length} teams · {detail.athletes.length} competitors
            {needsData > 0 && ` · ${needsData} need age or weight`}
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            {detail.candidateCount === 0 && <Button size="sm" variant="ghost" onClick={() => setSyncOpen(true)}>Sync from WellnessLiving</Button>}
            <Button size="sm" variant="secondary" onClick={() => setPasteOpen(true)}>Paste roster</Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>Add competitor</Button>
          </span>
        </div>
      )}
      {/* Outside the toolbar swap: a refused assign leaves the selection standing,
          and the message has to outlive the bar it was triggered from. */}
      {failure && <p role="alert" className="t2 text-fault">{failure.message}</p>}
      <AddKidDialog detail={detail} open={addOpen} onOpenChange={setAddOpen} onRefresh={() => setSyncOpen(true)} />
      <PasteRosterDialog detail={detail} open={pasteOpen} onOpenChange={setPasteOpen} />
      <SyncRosterDialog detail={detail} open={syncOpen} onOpenChange={setSyncOpen} />
      <Dialog open={removing.length > 0} onOpenChange={o => { if (!o) closeRemove() }}>
        {removing.length > 0 && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {removing.length === 1 ? `Remove ${athleteName(removing[0])}?` : `Remove ${removing.length} competitors?`}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className="t3 text-gray-11">This takes the competitor off this event's roster. Competitors already placed in a match cannot be removed.</p>
              {remove.error && <p role="alert" className="t2 text-fault">{remove.error.message}</p>}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={closeRemove}>Cancel</Button>
              <Button type="button" variant="destructive" disabled={remove.isPending} onClick={runRemove}>Remove</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      <div className="grid items-start gap-6 xl:grid-cols-3">
        {groups.map((g, i) => (
          <RosterGroup
            key={g.key}
            title={g.title}
            color={g.color}
            teamId={g.teamId}
            kids={g.kids}
            selected={selected}
            faults={faults}
            firstGroup={i === 0}
            dragging={drag.dragging}
            over={drag.over === dropZoneValue(g.teamId)}
            onSelect={onSelect}
            onPatch={onPatch}
            onRemove={kid => setRemoving([kid])}
            onDragStart={drag.start}
          />
        ))}
      </div>
    </div>
  )
}
