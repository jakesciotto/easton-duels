import { useEffect, useState, type FormEvent } from 'react'
import type { TeamColor } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail } from '@/lib/types'
import { TeamCard } from '@/components/TeamCard'
import { ColourSwatches } from '@/components/ColourSwatches'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

function today(): string {
  return new Date().toISOString().slice(0, 10)
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

  // Opening the dialog is the only thing that resets the form, so the deps stay at [open]:
  // the setters are stable and re-running on a changed create.reset would wipe live input.
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
      <DialogContent className="sm:max-w-[640px]">
        <form onSubmit={submit} className="grid min-h-0">
          <DialogHeader><DialogTitle>New event</DialogTitle></DialogHeader>
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
              <div className="grid gap-1.5">
                <Label htmlFor="ev-name">Event name</Label>
                <Input id="ev-name" required value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ev-date">Date</Label>
                <Input id="ev-date" type="date" required value={date} onChange={e => setDate(e.target.value)} className="font-mono tabular-nums" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TeamCard color={teamA.color} name={teamA.name} role="Team A">
                <div className="grid gap-1.5">
                  <Label htmlFor="team-a">Team A name</Label>
                  <Input id="team-a" required value={teamA.name} onChange={e => setTeamA({ ...teamA, name: e.target.value })} />
                </div>
                <ColourSwatches value={teamA.color} onChange={color => setTeamA({ ...teamA, color })} aria-label="Team A colour" />
              </TeamCard>
              <TeamCard color={teamB.color} name={teamB.name} role="Team B">
                <div className="grid gap-1.5">
                  <Label htmlFor="team-b">Team B name</Label>
                  <Input id="team-b" required value={teamB.name} onChange={e => setTeamB({ ...teamB, name: e.target.value })} />
                </div>
                <ColourSwatches value={teamB.color} onChange={color => setTeamB({ ...teamB, color })} aria-label="Team B colour" />
              </TeamCard>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="mats">Mats</Label>
                <Input id="mats" type="number" min={1} max={8} value={matCount} onChange={e => setMatCount(Number(e.target.value))} className="font-mono tabular-nums" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="age-gap">Max age gap (years)</Label>
                <Input id="age-gap" type="number" min={0} max={10} value={maxAgeGap} onChange={e => setMaxAgeGap(Number(e.target.value))} className="font-mono tabular-nums" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="weight-gap">Max weight gap (lb)</Label>
                <Input id="weight-gap" type="number" min={0} max={100} value={maxWeightGap} onChange={e => setMaxWeightGap(Number(e.target.value))} className="font-mono tabular-nums" />
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <Checkbox id="same-gender" checked={sameGender} onCheckedChange={v => setSameGender(v)} />
              <Label htmlFor="same-gender" className="text-sm text-foreground">Pair only competitors of the same gender</Label>
            </div>
            {create.error && <p role="alert" className="text-[13px] text-destructive">{create.error.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>Create event</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
