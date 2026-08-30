import { useState, type FormEvent } from 'react'
import { KIDS_BELTS } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail, ManualKid } from '@/lib/types'
import { beltLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const BELT_ITEMS = [{ value: null as string | null, label: 'No belt' }, ...KIDS_BELTS.map(b => ({ value: b as string | null, label: beltLabel(b) }))]
const GENDER_ITEMS = [{ value: null as string | null, label: 'Not set' }, { value: 'M', label: 'M' }, { value: 'F', label: 'F' }]

interface FormState {
  firstName: string
  lastName: string
  age: string
  weightLbs: string
  belt: string | null
  gender: string | null
  teamId: number | null
}
const empty: FormState = { firstName: '', lastName: '', age: '', weightLbs: '', belt: null, gender: null, teamId: null }

export function AddKidDialog({ detail, open, onOpenChange }: { detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState(empty)
  const add = useAdminMutation(detail.event.id, (manual: ManualKid) => adminApi(`/api/events/${detail.event.id}/athletes`, { method: 'POST', body: { manual } }))
  const teamItems = [{ value: null as number | null, label: 'Unassigned' }, ...detail.teams.map(t => ({ value: t.id as number | null, label: t.name }))]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate({
      firstName: f.firstName.trim(), lastName: f.lastName.trim(),
      age: f.age ? Number(f.age) : null, weightLbs: f.weightLbs ? Number(f.weightLbs) : null,
      belt: f.belt, gender: f.gender, teamId: f.teamId,
    }, {
      onSuccess: () => {
        setF(empty)
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={submit} className="grid min-h-0">
          <DialogHeader><DialogTitle>Add competitor</DialogTitle></DialogHeader>
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="k-first">First name</Label>
                <Input id="k-first" required value={f.firstName} onChange={e => setF({ ...f, firstName: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="k-last">Last name</Label>
                <Input id="k-last" required value={f.lastName} onChange={e => setF({ ...f, lastName: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="k-age">Age</Label>
                <Input id="k-age" type="number" min={3} max={17} className="font-mono tabular-nums" value={f.age} onChange={e => setF({ ...f, age: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="k-weight">Weight (lb)</Label>
                <Input id="k-weight" type="number" min={20} max={250} className="font-mono tabular-nums" value={f.weightLbs} onChange={e => setF({ ...f, weightLbs: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="k-belt">Belt</Label>
                <Select value={f.belt} onValueChange={belt => setF({ ...f, belt })} items={BELT_ITEMS}>
                  <SelectTrigger id="k-belt"><SelectValue placeholder="No belt" /></SelectTrigger>
                  <SelectContent>
                    {BELT_ITEMS.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="k-gender">Gender</Label>
                <Select value={f.gender} onValueChange={gender => setF({ ...f, gender })} items={GENDER_ITEMS}>
                  <SelectTrigger id="k-gender"><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>
                    {GENDER_ITEMS.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="k-team">Team</Label>
              <Select value={f.teamId} onValueChange={teamId => setF({ ...f, teamId })} items={teamItems}>
                <SelectTrigger id="k-team"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {teamItems.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {add.error && <p role="alert" className="text-[13px] text-destructive">{add.error.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={add.isPending}>Add competitor</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
