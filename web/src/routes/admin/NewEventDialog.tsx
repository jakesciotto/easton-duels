import { useEffect, useState, type FormEvent } from 'react'
import type { EventMode } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { MODE_GROUP_LABEL, MODE_HELP, MODE_OPTIONS, toMode } from '@/lib/eventMode'
import { rankTeams } from '@/lib/leaderboard'
import type { EventDetail } from '@/lib/types'
import { cn } from '@/lib/utils'
import { TeamPlate } from '@/components/TeamPlate'
import { SetupSteps } from '@/components/SetupSteps'
import { TeamList, type TeamDraft } from '@/routes/event/TeamList'
import { dialogBody, dialogFooter, dialogStack, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segment } from '@/components/ui/segment'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const STARTING_TEAMS: TeamDraft[] = [{ name: '', color: 'red' }, { name: '', color: 'blue' }]

// 7.8: never <input type="number">. The spinner adds arrows the numeric track has no
// room for and hijacks the scroll wheel, so every count is a text field that carries
// its own range and reports its own invalidity.
function whole(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const n = Number(value)
  return n >= min && n <= max ? n : null
}

function CountField({ id, label, value, min, max, onChange }: {
  id: string
  label: string
  value: string
  min: number
  max: number
  onChange: (v: string) => void
}) {
  const bad = value !== '' && whole(value, min, max) === null
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        inputMode="numeric"
        autoComplete="off"
        maxLength={3}
        aria-invalid={bad || undefined}
        onChange={e => onChange(e.target.value)}
        className="fig w-[var(--col-num-s)] text-right"
      />
    </div>
  )
}

// The room's view, at the type step the console reads at. Nothing here is a board token:
// the board is sized in cqh against its own stage and this is a still life of it.
function LeaderboardPreview({ teams }: { teams: TeamDraft[] }) {
  const rows = rankTeams(teams.map((_, i) => ({ id: i, wins: 0, points: 0, position: i })))
  return (
    <div className="grid gap-2">
      <span className="t1 uppercase text-gray-10">The room's view</span>
      <div aria-hidden className="grid gap-3 bg-background p-4">
        {rows.map(row => (
          <div key={row.teamId} className="grid grid-cols-[var(--col-num-s)_minmax(0,1fr)_62.4px] items-center gap-x-6">
            <span className="fig t3 text-gray-10">{row.rank}</span>
            <TeamPlate color={teams[row.teamId].color} name={teams[row.teamId].name || `Team ${row.teamId + 1}`} size="scorer" />
            <span className="fig fig-2 t5 text-right text-gray-12">0</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function NewEventDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (d: EventDetail) => void }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [mode, setMode] = useState<EventMode>('live')
  const [matCount, setMatCount] = useState('1')
  // Two rows to start, to eight, and never below two. The rows are still a draft here:
  // nothing reaches the server until Continue.
  const [teams, setTeams] = useState<TeamDraft[]>(STARTING_TEAMS)
  const [sameGender, setSameGender] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const create = useAdminMutation(null, (body: unknown) => adminApi<EventDetail>('/api/events', { method: 'POST', body }))

  // Opening the dialog is the only thing that resets the form, so the deps stay at [open]:
  // the setters are stable and re-running on a changed create.reset would wipe live input.
  useEffect(() => {
    if (!open) return
    setName('')
    setDate(today())
    setMode('live')
    setMatCount('1')
    setTeams(STARTING_TEAMS)
    setSameGender(false)
    setContactName('')
    setContactPhone('')
    create.reset()
  }, [open])

  const mats = whole(matCount, 1, 8)
  const counts = mats !== null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!counts) return
    create.mutate({
      name, date, mode, matCount: mats, teams: teams.map(t => ({ name: t.name, color: t.color })),
      sameGender,
      contactName: contactName.trim(), contactPhone: contactPhone.trim(),
    }, {
      onSuccess: detail => {
        onOpenChange(false)
        onCreated(detail)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(640)}>
        <form onSubmit={submit} className={dialogStack}>
          <DialogHeader>
            <div className="grid gap-1">
              <DialogTitle>New event</DialogTitle>
              <SetupSteps current={1} />
            </div>
          </DialogHeader>
          <DialogBody className={cn(dialogBody, 'gap-4')}>
            <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
              <div className="grid gap-2">
                <Label htmlFor="ev-name">Event name</Label>
                <Input id="ev-name" required value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ev-date">Date</Label>
                <Input id="ev-date" type="date" required value={date} onChange={e => setDate(e.target.value)} className="fig" />
              </div>
            </div>

            {/* One exported option set, so this dialog and the event shell name the two
                ways an event runs in the same words, in the same order. */}
            <div className="grid gap-2">
              <span className="t2 text-gray-11 font-medium!">{MODE_GROUP_LABEL}</span>
              <Segment aria-label={MODE_GROUP_LABEL} value={mode} onValueChange={v => setMode(toMode(v))} options={MODE_OPTIONS} />
              <p className="t2 text-gray-10">{MODE_HELP[mode]}</p>
            </div>

            <TeamList
              teams={teams}
              onChange={(i, next) => setTeams(list => list.map((t, at) => (at === i ? next : t)))}
              onAdd={team => setTeams(list => [...list, team])}
              onRemove={i => setTeams(list => list.filter((_, at) => at !== i))}
            />
            <LeaderboardPreview teams={teams} />

            <CountField id="mats" label="Mats" value={matCount} min={1} max={8} onChange={setMatCount} />

            <div className="flex items-center gap-2">
              <Checkbox id="same-gender" checked={sameGender} onCheckedChange={v => setSameGender(v)} />
              <Label htmlFor="same-gender" className="text-gray-11">Pair only competitors of the same gender</Label>
            </div>

            {/* 6.4's escalation contact. Optional here on purpose: on the morning an
                event is created nobody has decided who is running the desk, so the pair
                is also settable from the event shell. Both halves or neither: a name
                with no number gives a volunteer nothing to act on. */}
            <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
              <div className="grid gap-2">
                <Label htmlFor="ev-contact-name">Desk contact (optional)</Label>
                <Input id="ev-contact-name" value={contactName} maxLength={60} autoComplete="off" onChange={e => setContactName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ev-contact-phone">Phone</Label>
                <Input
                  id="ev-contact-phone"
                  value={contactPhone}
                  maxLength={30}
                  inputMode="tel"
                  autoComplete="off"
                  onChange={e => setContactPhone(e.target.value)}
                  className="fig"
                />
              </div>
            </div>

            {create.error && (
              <Alert>
                <AlertTitle>The event was not created</AlertTitle>
                <AlertDescription>{create.error.message}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter className={dialogFooter}>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            {/* The event is one of three steps, so the primary names the next screen
                rather than the row it just wrote. */}
            <Button type="submit" disabled={!counts || create.isPending}>Continue</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
