import { useState, type DragEvent } from 'react'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { AthleteRow, EventDetail } from '@/lib/types'
import { athleteName, beltLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AddKidDialog } from './AddKidDialog'
import { PasteRosterDialog } from './PasteRosterDialog'
import { SyncRosterDialog } from './SyncRosterDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { List, ListRow } from '@/components/ui/list'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TeamCard } from '@/components/TeamCard'

function NumberCell({ label, value, onSave, source }: { label: string; value: number | null; onSave: (v: number | null) => void; source: string | null }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const commit = () => {
    const next = draft === '' ? null : Number(draft)
    if (next !== value && (next === null || Number.isFinite(next))) onSave(next)
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input aria-label={label} inputMode="numeric" value={draft}
        onChange={e => setDraft(e.target.value.replace(/\D/g, ''))} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="h-7 w-12 bg-background px-1 text-right font-mono tabular-nums" />
      {value !== null && source === 'leaderboard' && <Badge variant="done">estimated</Badge>}
    </span>
  )
}

function KidRow({ kid, selected, onSelect, onPatch, onRemove }: {
  kid: AthleteRow; selected: boolean; onSelect: (v: boolean) => void
  onPatch: (body: Partial<AthleteRow>) => void; onRemove: () => void
}) {
  const name = athleteName(kid)
  return (
    <ListRow draggable onDragStart={e => e.dataTransfer.setData('text/plain', String(kid.id))} className="flex items-center gap-3">
      <Checkbox aria-label={`Select ${name}`} checked={selected} onCheckedChange={checked => onSelect(checked)} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-faint">
          <span>{beltLabel(kid.belt)}</span>
          {kid.gender && <span>{kid.gender}</span>}
          {kid.erp !== null && <Badge>ERP <span className="font-mono tabular-nums">{kid.erp.toFixed(1)}</span></Badge>}
          {kid.age === null && <Badge variant="warn">missing age</Badge>}
          {kid.weightLbs === null && <Badge variant="warn">missing weight</Badge>}
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-[13px] text-faint">age
        <NumberCell label={`Age for ${name}`} value={kid.age} source={kid.ageSource} onSave={age => onPatch({ age })} />
      </label>
      <label className="flex items-center gap-1.5 text-[13px] text-faint">lb
        <NumberCell label={`Weight for ${name}`} value={kid.weightLbs} source={kid.weightSource} onSave={weightLbs => onPatch({ weightLbs })} />
      </label>
      <Button size="sm" variant="ghost" aria-label={`Remove ${name}`} onClick={onRemove}>Remove</Button>
    </ListRow>
  )
}

function Column({ title, roleLabel, color, teamId, kids, selected, onSelect, onPatch, onMove, onRemove }: {
  title: string; roleLabel?: string; color: string | null; teamId: number | null; kids: AthleteRow[]; selected: Set<number>
  onSelect: (id: number, v: boolean) => void; onPatch: (id: number, body: Partial<AthleteRow>) => void
  onMove: (ids: number[], teamId: number | null) => void; onRemove: (kid: AthleteRow) => void
}) {
  const [over, setOver] = useState(false)
  const selectedHere = kids.filter(k => selected.has(k.id)).length
  const selectedElsewhere = selected.size - selectedHere
  const moveHere = () => onMove([...selected].filter(id => !kids.some(k => k.id === id)), teamId)
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const id = Number(e.dataTransfer.getData('text/plain'))
    if (id) onMove([id], teamId)
  }

  const toolbar = (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-faint"><span className="font-mono tabular-nums">{kids.length}</span> {kids.length === 1 ? 'competitor' : 'competitors'}</span>
      {selectedElsewhere > 0 && <Button size="sm" variant="secondary" onClick={moveHere}>Move {selectedElsewhere} here</Button>}
    </div>
  )
  const list = (
    <List>
      {kids.length === 0
        ? <ListRow className="text-[13px] text-faint">No competitors here yet</ListRow>
        : kids.map(k => <KidRow key={k.id} kid={k} selected={selected.has(k.id)} onSelect={v => onSelect(k.id, v)} onPatch={body => onPatch(k.id, body)} onRemove={() => onRemove(k)} />)}
    </List>
  )

  return (
    <section aria-label={title} onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}>
      {color ? (
        <TeamCard color={color} name={title} role={roleLabel ?? ''} className={over ? 'border-foreground' : undefined}>
          {toolbar}
          {list}
        </TeamCard>
      ) : (
        <Card className={cn('grid gap-2.5 p-4', over && 'border-foreground')}>
          <span className="font-medium">{title}</span>
          {toolbar}
          {list}
        </Card>
      )}
    </section>
  )
}

export function RosterTab({ detail }: { detail: EventDetail }) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [removing, setRemoving] = useState<AthleteRow | null>(null)
  const eventId = detail.event.id
  const assign = useAdminMutation(eventId, (v: { ids: number[]; teamId: number | null }) => adminApi(`/api/events/${eventId}/athletes/assign`, { method: 'POST', body: v }))
  const patch = useAdminMutation(eventId, (v: { id: number; body: Partial<AthleteRow> }) => adminApi(`/api/athletes/${v.id}`, { method: 'PATCH', body: v.body }))
  const remove = useAdminMutation(eventId, (id: number) => adminApi(`/api/athletes/${id}`, { method: 'DELETE' }))

  const onSelect = (id: number, v: boolean) => setSelected(s => {
    const n = new Set(s)
    if (v) n.add(id)
    else n.delete(id)
    return n
  })
  const onMove = (ids: number[], teamId: number | null) => {
    if (ids.length === 0) return
    assign.mutate({ ids, teamId }, { onSuccess: () => setSelected(new Set()) })
  }

  // Cancel, the backdrop, Escape, and a successful remove all close through here,
  // so a failed remove's message never outlives the dialog it was shown in.
  const closeRemove = () => {
    setRemoving(null)
    remove.reset()
  }
  const runRemove = () => {
    if (!removing) return
    const id = removing.id
    remove.mutate(id, {
      onSuccess: () => {
        setSelected(s => {
          const n = new Set(s)
          n.delete(id)
          return n
        })
        closeRemove()
      },
    })
  }
  const byTeam = (teamId: number | null) => detail.athletes.filter(a => a.teamId === teamId).sort((x, y) => x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName))
  const [teamA, teamB] = detail.teams

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setAddOpen(true)}>Add competitor</Button>
        <Button variant="secondary" onClick={() => setPasteOpen(true)}>Paste roster</Button>
        <Button variant="secondary" onClick={() => setSyncOpen(true)}>Sync from WellnessLiving</Button>
        {(assign.error || patch.error) && <p role="alert" className="self-center text-[13px] text-destructive">{(assign.error ?? patch.error)?.message}</p>}
      </div>
      <AddKidDialog detail={detail} open={addOpen} onOpenChange={setAddOpen} />
      <PasteRosterDialog detail={detail} open={pasteOpen} onOpenChange={setPasteOpen} />
      <SyncRosterDialog detail={detail} open={syncOpen} onOpenChange={setSyncOpen} />
      <Dialog open={removing !== null} onOpenChange={o => { if (!o) closeRemove() }}>
        {removing && (
          <DialogContent>
            <DialogHeader><DialogTitle>Remove {athleteName(removing)}?</DialogTitle></DialogHeader>
            <DialogBody>
              <p className="text-sm text-soft">This takes the competitor off this event's roster. Competitors already placed in a match cannot be removed.</p>
              {remove.error && <p role="alert" className="text-[13px] text-destructive">{remove.error.message}</p>}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={closeRemove}>Cancel</Button>
              <Button type="button" variant="destructive" disabled={remove.isPending} onClick={runRemove}>Remove</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      <div className="grid gap-4 lg:grid-cols-3">
        <Column title={teamA.name} roleLabel="Team A" color={teamA.color} teamId={teamA.id} kids={byTeam(teamA.id)} selected={selected} onSelect={onSelect} onPatch={(id, body) => patch.mutate({ id, body })} onMove={onMove} onRemove={setRemoving} />
        <Column title="Unassigned" color={null} teamId={null} kids={byTeam(null)} selected={selected} onSelect={onSelect} onPatch={(id, body) => patch.mutate({ id, body })} onMove={onMove} onRemove={setRemoving} />
        <Column title={teamB.name} roleLabel="Team B" color={teamB.color} teamId={teamB.id} kids={byTeam(teamB.id)} selected={selected} onSelect={onSelect} onPatch={(id, body) => patch.mutate({ id, body })} onMove={onMove} onRemove={setRemoving} />
      </div>
    </div>
  )
}
