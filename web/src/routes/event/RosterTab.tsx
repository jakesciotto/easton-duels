import { useState, type DragEvent } from 'react'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { AthleteRow, EventDetail } from '@/lib/types'
import { athleteName, beltLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AddKidDialog } from './AddKidDialog'
import { PasteRosterDialog } from './PasteRosterDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { List, ListRow } from '@/components/ui/list'
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

function KidRow({ kid, selected, onSelect, onPatch }: { kid: AthleteRow; selected: boolean; onSelect: (v: boolean) => void; onPatch: (body: Partial<AthleteRow>) => void }) {
  const name = athleteName(kid)
  return (
    <ListRow draggable onDragStart={e => e.dataTransfer.setData('text/plain', String(kid.id))} className="flex items-center gap-3">
      <Checkbox aria-label={`Select ${name}`} checked={selected} onCheckedChange={checked => onSelect(checked)} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-faint">
          <span>{beltLabel(kid.belt)}</span>
          {kid.gender && <span>{kid.gender}</span>}
          {kid.erp !== null && <Badge>ERP {kid.erp.toFixed(1)}</Badge>}
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
    </ListRow>
  )
}

function Column({ title, roleLabel, color, teamId, kids, selected, onSelect, onPatch, onMove }: {
  title: string; roleLabel?: string; color: string | null; teamId: number | null; kids: AthleteRow[]; selected: Set<number>
  onSelect: (id: number, v: boolean) => void; onPatch: (id: number, body: Partial<AthleteRow>) => void; onMove: (ids: number[], teamId: number | null) => void
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
      <span className="text-[13px] text-faint"><span className="font-mono tabular-nums">{kids.length}</span> {kids.length === 1 ? 'kid' : 'kids'}</span>
      {selectedElsewhere > 0 && <Button size="sm" variant="secondary" onClick={moveHere}>Move {selectedElsewhere} here</Button>}
    </div>
  )
  const list = (
    <List>
      {kids.length === 0
        ? <ListRow className="text-[13px] text-faint">No kids here yet</ListRow>
        : kids.map(k => <KidRow key={k.id} kid={k} selected={selected.has(k.id)} onSelect={v => onSelect(k.id, v)} onPatch={body => onPatch(k.id, body)} />)}
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
  const eventId = detail.event.id
  const assign = useAdminMutation(eventId, (v: { ids: number[]; teamId: number | null }) => adminApi(`/api/events/${eventId}/athletes/assign`, { method: 'POST', body: v }))
  const patch = useAdminMutation(eventId, (v: { id: number; body: Partial<AthleteRow> }) => adminApi(`/api/athletes/${v.id}`, { method: 'PATCH', body: v.body }))

  const onSelect = (id: number, v: boolean) => setSelected(s => {
    const n = new Set(s)
    if (v) n.add(id)
    else n.delete(id)
    return n
  })
  const onMove = async (ids: number[], teamId: number | null) => {
    if (ids.length === 0) return
    await assign.mutateAsync({ ids, teamId })
    setSelected(new Set())
  }
  const byTeam = (teamId: number | null) => detail.athletes.filter(a => a.teamId === teamId).sort((x, y) => x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName))
  const [teamA, teamB] = detail.teams

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setAddOpen(true)}>Add kid</Button>
        <Button variant="secondary" onClick={() => setPasteOpen(true)}>Paste roster</Button>
        {(assign.error || patch.error) && <p role="alert" className="self-center text-[13px] text-destructive">{(assign.error ?? patch.error)?.message}</p>}
      </div>
      <AddKidDialog detail={detail} open={addOpen} onOpenChange={setAddOpen} />
      <PasteRosterDialog detail={detail} open={pasteOpen} onOpenChange={setPasteOpen} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Column title={teamA.name} roleLabel="Team A" color={teamA.color} teamId={teamA.id} kids={byTeam(teamA.id)} selected={selected} onSelect={onSelect} onPatch={(id, body) => patch.mutate({ id, body })} onMove={onMove} />
        <Column title="Unassigned" color={null} teamId={null} kids={byTeam(null)} selected={selected} onSelect={onSelect} onPatch={(id, body) => patch.mutate({ id, body })} onMove={onMove} />
        <Column title={teamB.name} roleLabel="Team B" color={teamB.color} teamId={teamB.id} kids={byTeam(teamB.id)} selected={selected} onSelect={onSelect} onPatch={(id, body) => patch.mutate({ id, body })} onMove={onMove} />
      </div>
    </div>
  )
}
