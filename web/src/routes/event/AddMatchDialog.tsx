import { useEffect, useState, type FormEvent } from 'react'
import { formatClock } from '@shared/clock'
import { writeErrorMessage } from '@/lib/eventMode'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { AthleteRow, EventDetail, TeamRow } from '@/lib/types'
import { athleteName, beltLabel } from '@/lib/format'
import { isDoubleBooked } from '@/lib/doubleBooking'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogStack, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { TeamPlate } from '@/components/TeamPlate'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { clockToSec, maskClock } from './clock-input'

const LEAST_LOADED = ''

interface CreateResult { warnings?: string[] }

/**
 * An event holds up to eight teams, so neither slot belongs to one of them any more. Each
 * offers every competitor on a team other than the one the other slot holds, and each
 * option carries its own plate because the two lists now span the whole event.
 */
function KidSlot({ id, label, kids, teamOf, matches, value, onChange, align, className }: {
  id: string
  label: string
  kids: AthleteRow[]
  teamOf: (kid: AthleteRow) => TeamRow | undefined
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
      <Label htmlFor={id} className={cn(align === 'right' && 'justify-end')}>{label}</Label>
      <Select value={value} onValueChange={v => onChange(String(v ?? ''))} items={items}>
        <SelectTrigger id={id}><SelectValue placeholder="Pick a competitor" /></SelectTrigger>
        <SelectContent>
          {kids.map(k => {
            const team = teamOf(k)
            return (
              <SelectItem key={k.id} value={String(k.id)}>
                <span className="flex min-w-0 items-center gap-2">
                  {team && <TeamPlate color={team.color} name={team.name} size="inline" showName={false} />}
                  <span className="truncate">{athleteName(k)}</span>
                </span>
                <span className="ml-auto shrink-0 t2 text-gray-10">
                  {[beltLabel(k.belt), k.age ?? '--', k.weightLbs === null ? '--' : `${k.weightLbs} lb`].join(' · ')}
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}

export function AddMatchDialog({ detail, start, open, onOpenChange }: {
  detail: EventDetail
  /** A competitor the caller already chose, seeded into the first slot. */
  start?: number | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [aId, setAId] = useState('')
  const [bId, setBId] = useState('')
  const [rulesetId, setRulesetId] = useState('')
  const [length, setLength] = useState('')
  const [matId, setMatId] = useState(LEAST_LOADED)
  // What the server said about the pair it just accepted. A warning never blocks a save,
  // so it is reported after the write rather than instead of it.
  const [warnings, setWarnings] = useState<string[]>([])
  const create = useAdminMutation(detail.event.id, (body: unknown) => adminApi<CreateResult>(`/api/events/${detail.event.id}/matches`, { method: 'POST', body }))

  // Opening the dialog is the only thing that resets the form, so the deps stay at the
  // two facts the caller controls: a later edit to the roster or the rulesets must not
  // wipe what is half typed.
  useEffect(() => {
    if (!open) return
    setAId(start === null || start === undefined ? '' : String(start))
    setBId('')
    setWarnings([])
    setRulesetId(String(detail.rulesets[0]?.id ?? ''))
    setLength(formatClock((detail.rulesets[0]?.defaultLengthSec ?? 300) * 1000))
    setMatId(LEAST_LOADED)
    create.reset()
  }, [open, start])

  const teamOf = (kid: AthleteRow) => detail.teams.find(t => t.id === kid.teamId)
  // A competitor with no team cannot be in a match, because a match pairs two teams.
  const placeable = detail.athletes.filter(a => a.teamId !== null).sort((x, y) => x.lastName.localeCompare(y.lastName))
  const pickOf = (v: string) => detail.athletes.find(a => String(a.id) === v)
  const aPick = pickOf(aId)
  const bPick = pickOf(bId)
  const otherThan = (kid: AthleteRow | undefined) => placeable.filter(k => kid === undefined || k.teamId !== kid.teamId)

  const rulesetItems = detail.rulesets.map(r => ({ value: String(r.id), label: r.name }))
  const doubleBookedPicks = [aPick, bPick]
    .filter((k): k is AthleteRow => k !== undefined && isDoubleBooked(k.id, detail.matches))
  const lengthSec = clockToSec(length)
  const ready = aId !== '' && bId !== '' && rulesetId !== '' && lengthSec !== null

  // Changing one slot to a competitor on the other slot's team would leave a pairing the
  // server refuses, so the other slot lets go rather than sitting there illegal.
  const pickA = (v: string) => {
    setAId(v)
    const next = pickOf(v)
    if (next && bPick && next.teamId === bPick.teamId) setBId('')
  }
  const pickB = (v: string) => {
    setBId(v)
    const next = pickOf(v)
    if (next && aPick && next.teamId === aPick.teamId) setAId('')
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setWarnings([])
    create.mutate(
      { athleteAId: Number(aId), athleteBId: Number(bId), rulesetId: Number(rulesetId), lengthSec, matId: matId === LEAST_LOADED ? undefined : Number(matId) },
      {
        onSuccess: r => {
          const said = r?.warnings ?? []
          if (said.length === 0) { onOpenChange(false); return }
          // The match is on file. The dialog stays up to report what the server noticed
          // about it, with both slots cleared for the next pair.
          setWarnings(said)
          setAId('')
          setBId('')
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(512)}>
        <form onSubmit={submit} className={dialogStack}>
          <DialogHeader><DialogTitle>Add match</DialogTitle></DialogHeader>
          <DialogBody className={cn(dialogBody, 'gap-4 sm:grid-cols-2')}>
            <KidSlot id="am-a" label="First competitor" kids={otherThan(bPick)} teamOf={teamOf} matches={detail.matches} value={aId} onChange={pickA} align="left" className="sm:col-start-1 sm:row-start-1" />
            <KidSlot id="am-b" label="Second competitor" kids={otherThan(aPick)} teamOf={teamOf} matches={detail.matches} value={bId} onChange={pickB} align="right" className="sm:col-start-2 sm:row-start-1" />

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

            {warnings.length > 0 && (
              <Alert variant="attend" className="sm:col-span-2">
                <AlertTitle variant="attend">Match added</AlertTitle>
                {warnings.map(w => <AlertDescription key={w}>{w}</AlertDescription>)}
              </Alert>
            )}
            {doubleBookedPicks.length > 0 && (
              <Alert variant="attend" className="sm:col-span-2">
                <AlertTitle variant="attend">Already booked</AlertTitle>
                {doubleBookedPicks.map(k => <AlertDescription key={k.id}>{athleteName(k)} is already in a pending match</AlertDescription>)}
              </Alert>
            )}
            {create.error && (
              <Alert className="sm:col-span-2">
                <AlertTitle>That match was not added</AlertTitle>
                <AlertDescription>{writeErrorMessage(create.error)}</AlertDescription>
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
