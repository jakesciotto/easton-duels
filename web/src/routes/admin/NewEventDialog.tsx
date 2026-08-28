import { useEffect, useState, type FormEvent } from 'react'
import { TEAM_COLOR_KEYS, type TeamColor } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail } from '@/lib/types'
import { teamHex } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function ColorPicker({ id, value, onChange }: { id: string; value: TeamColor; onChange: (c: TeamColor) => void }) {
  return (
    <div id={id} role="radiogroup" className="flex flex-wrap gap-2">
      {TEAM_COLOR_KEYS.map(c => (
        <button key={c} type="button" role="radio" aria-checked={c === value} aria-label={c} onClick={() => onChange(c)}
          className="size-7 rounded-full border-2 aria-checked:border-foreground border-transparent" style={{ background: teamHex(c) }} />
      ))}
    </div>
  )
}

export function NewEventDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (d: EventDetail) => void }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [matCount, setMatCount] = useState(1)
  const [teamA, setTeamA] = useState({ name: '', color: 'red' as TeamColor })
  const [teamB, setTeamB] = useState({ name: '', color: 'blue' as TeamColor })
  const [maxAgeGap, setMaxAgeGap] = useState(1)
  const [maxWeightGap, setMaxWeightGap] = useState(10)
  const [sameGender, setSameGender] = useState(false)
  const create = useAdminMutation(null, (body: unknown) => adminApi<EventDetail>('/api/events', { method: 'POST', body }))

  useEffect(() => {
    if (!open) return
    setName('')
    setDate(today())
    setMatCount(1)
    setTeamA({ name: '', color: 'red' })
    setTeamB({ name: '', color: 'blue' })
    setMaxAgeGap(1)
    setMaxWeightGap(10)
    setSameGender(false)
    create.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate({ name, date, matCount, teams: [teamA, teamB], maxAgeGap, maxWeightGap, sameGender }, {
      onSuccess: detail => {
        onOpenChange(false)
        onCreated(detail)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New event</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="ev-name">Event name</Label>
              <Input id="ev-name" required value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ev-date">Date</Label>
              <Input id="ev-date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="team-a">Team A name</Label>
              <Input id="team-a" required value={teamA.name} onChange={e => setTeamA({ ...teamA, name: e.target.value })} />
              <ColorPicker id="team-a-color" value={teamA.color} onChange={color => setTeamA({ ...teamA, color })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-b">Team B name</Label>
              <Input id="team-b" required value={teamB.name} onChange={e => setTeamB({ ...teamB, name: e.target.value })} />
              <ColorPicker id="team-b-color" value={teamB.color} onChange={color => setTeamB({ ...teamB, color })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="mats">Mats</Label>
              <Input id="mats" type="number" min={1} max={8} value={matCount} onChange={e => setMatCount(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="age-gap">Max age gap (years)</Label>
              <Input id="age-gap" type="number" min={0} max={10} value={maxAgeGap} onChange={e => setMaxAgeGap(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="weight-gap">Max weight gap (lb)</Label>
              <Input id="weight-gap" type="number" min={0} max={100} value={maxWeightGap} onChange={e => setMaxWeightGap(Number(e.target.value))} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sameGender} onChange={e => setSameGender(e.target.checked)} />
            Pair only kids of the same gender
          </label>
          {create.error && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>Create event</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
