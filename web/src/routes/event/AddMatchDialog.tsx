import { useEffect, useState, type FormEvent } from 'react'
import { formatClock } from '@shared/clock'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { AthleteRow, EventDetail, TeamRow } from '@/lib/types'
import { athleteName } from '@/lib/format'
import { isDoubleBooked } from '@/lib/doubleBooking'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogStack, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { clockToSec, maskClock } from './clock-input'

const LEAST_LOADED = ''

// Team A is left and first on every surface, so the two competitor slots are placed
// rather than stacked: the dialog reads in the same direction as the Entry tab and the
// board hero. DOM order still matches tab order.
function KidSlot({ id, team, kids, matches, value, onChange, align, className }: {
  id: string
  team: TeamRow
  kids: AthleteRow[]
  matches: EventDetail['matches']
  value: string
  onChange: (v: string) => void
  align: 'left' | 'right'
  className?: string
}) {
  const items = kids.map(k => ({
    value: String(k.id),
    label: athleteName(k) + (isDoubleBooked(k.id, matches) ? ' (double-booked)' : ''),
  }))
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={id} className={cn(align === 'right' && 'justify-end')}>{team.name} competitor</Label>
      <Select value={value} onValueChange={v => onChange(String(v ?? ''))} items={items}>
        <SelectTrigger id={id}><SelectValue placeholder="Pick a competitor" /></SelectTrigger>
        <SelectContent>
          {items.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

export function AddMatchDialog({ detail, open, onOpenChange }: { detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [teamA, teamB] = detail.teams
  const [aId, setAId] = useState('')
  const [bId, setBId] = useState('')
  const [rulesetId, setRulesetId] = useState('')
  const [length, setLength] = useState('')
  const [matId, setMatId] = useState(LEAST_LOADED)
  const create = useAdminMutation(detail.event.id, (body: unknown) => adminApi(`/api/events/${detail.event.id}/matches`, { method: 'POST', body }))

  // Opening the dialog is the only thing that resets the form, so the deps stay at [open]:
  // a later edit to the roster or the rulesets must not wipe what is half typed.
  useEffect(() => {
    if (!open) return
    setAId('')
    setBId('')
    setRulesetId(String(detail.rulesets[0]?.id ?? ''))
    setLength(formatClock((detail.rulesets[0]?.defaultLengthSec ?? 300) * 1000))
    setMatId(LEAST_LOADED)
    create.reset()
  }, [open])

  const kids = (teamId: number) => detail.athletes.filter(a => a.teamId === teamId).sort((x, y) => x.lastName.localeCompare(y.lastName))
  const rulesetItems = detail.rulesets.map(r => ({ value: String(r.id), label: r.name }))
  const doubleBookedPicks = [aId, bId]
    .map(v => detail.athletes.find(a => String(a.id) === v))
    .filter((k): k is AthleteRow => k !== undefined && isDoubleBooked(k.id, detail.matches))
  const lengthSec = clockToSec(length)
  const ready = aId !== '' && bId !== '' && rulesetId !== '' && lengthSec !== null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    create.mutate(
      { athleteAId: Number(aId), athleteBId: Number(bId), rulesetId: Number(rulesetId), lengthSec, matId: matId === LEAST_LOADED ? undefined : Number(matId) },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(512)}>
        <form onSubmit={submit} className={dialogStack}>
          <DialogHeader><DialogTitle>Add match</DialogTitle></DialogHeader>
          <DialogBody className={cn(dialogBody, 'gap-4 sm:grid-cols-2')}>
            <KidSlot id="am-a" team={teamA} kids={kids(teamA.id)} matches={detail.matches} value={aId} onChange={setAId} align="left" className="sm:col-start-1 sm:row-start-1" />
            <KidSlot id="am-b" team={teamB} kids={kids(teamB.id)} matches={detail.matches} value={bId} onChange={setBId} align="right" className="sm:col-start-2 sm:row-start-1" />

            <div className="grid gap-2">
              <Label htmlFor="am-rs">Ruleset</Label>
              <Select
                value={rulesetId} items={rulesetItems}
                onValueChange={v => {
                  const next = String(v ?? '')
                  setRulesetId(next)
                  const r = detail.rulesets.find(x => String(x.id) === next)
                  if (r) setLength(formatClock(r.defaultLengthSec * 1000))
                }}
              >
                <SelectTrigger id="am-rs"><SelectValue placeholder="Pick a ruleset" /></SelectTrigger>
                <SelectContent>
                  {rulesetItems.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="am-len">Length (m:ss)</Label>
              <Input
                id="am-len" required inputMode="numeric" autoComplete="off"
                aria-invalid={lengthSec === null || undefined}
                value={length} onChange={e => setLength(maskClock(e.target.value))}
                className="fig fig-4 w-[var(--col-num-l)] text-right"
              />
            </div>

            <div className="grid gap-2 sm:col-span-2" role="group" aria-label="Mat">
              <span className="t2 text-gray-10">Mat</span>
              <div className="flex flex-wrap gap-2">
                <Toggle size="sm" pressed={matId === LEAST_LOADED} onPressedChange={() => setMatId(LEAST_LOADED)}>Least loaded</Toggle>
                {detail.mats.map(m => (
                  <Toggle key={m.id} size="sm" pressed={matId === String(m.id)} onPressedChange={() => setMatId(String(m.id))}>Mat {m.number}</Toggle>
                ))}
              </div>
            </div>

            {doubleBookedPicks.length > 0 && (
              <Alert variant="attend" className="sm:col-span-2">
                <AlertTitle variant="attend">Already booked</AlertTitle>
                {doubleBookedPicks.map(k => <AlertDescription key={k.id}>{athleteName(k)} is already in a pending match</AlertDescription>)}
              </Alert>
            )}
            {create.error && (
              <Alert className="sm:col-span-2">
                <AlertTitle>That match was not added</AlertTitle>
                <AlertDescription>{create.error.message}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter className={dialogFooter}>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!ready || create.isPending}>Add match</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
