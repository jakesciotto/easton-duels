import { useEffect, useState, type FormEvent } from 'react'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { TEAM_COLOR_KEYS, TEAM_COLOR_LABELS, teamCode, type EventMode, type TeamColor } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { MODE_GROUP_LABEL, MODE_HELP, MODE_OPTIONS, toMode } from '@/lib/eventMode'
import { teamStyle } from '@/lib/format'
import { pairVerdict, type GuardLevel } from '@/lib/team-guard'
import type { EventDetail } from '@/lib/types'
import { cn } from '@/lib/utils'
import { TeamPlate } from '@/components/TeamPlate'
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

interface Team { name: string; color: TeamColor }

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

/**
 * 2.4's two guards, enforced from the tables rather than from memory. An illegal
 * partner renders at 40 percent with `aria-disabled` and is refused on selection with
 * the reason named, because a swatch that silently does nothing teaches nothing.
 */
function ColourGrid({ value, other, onChange, label }: {
  value: TeamColor
  other: TeamColor
  onChange: (c: TeamColor) => void
  label: string
}) {
  const [refused, setRefused] = useState<TeamColor | null>(null)
  const verdicts = new Map(TEAM_COLOR_KEYS.map(c => [c, pairVerdict(other, c)]))
  const levelOf = (c: TeamColor): GuardLevel => verdicts.get(c)?.level ?? 'ok'
  const shown = refused !== null && levelOf(refused) === 'block' ? refused : levelOf(value) === 'warn' ? value : null

  return (
    <div className="grid gap-2">
      <RadioGroup
        value={value}
        aria-label={label}
        onValueChange={v => {
          const next = v as TeamColor
          if (levelOf(next) === 'block') return setRefused(next)
          setRefused(null)
          onChange(next)
        }}
        className="flex flex-wrap gap-2"
      >
        {TEAM_COLOR_KEYS.map(c => (
          <Radio.Root
            key={c}
            value={c}
            aria-label={TEAM_COLOR_LABELS[c]}
            aria-disabled={levelOf(c) === 'block' || undefined}
            style={teamStyle(c)}
            className={cn(
              'team-dot size-[18px] rounded-full outline-none transition-opacity duration-150 ease-standard focus-visible:shadow-focus data-checked:ring-[1.5px] data-checked:ring-primary data-checked:ring-offset-2 data-checked:ring-offset-card',
              levelOf(c) === 'block' && 'opacity-40',
            )}
          />
        ))}
      </RadioGroup>
      {shown !== null && <p className="t2 text-gray-10">{verdicts.get(shown)?.reason}</p>}
    </div>
  )
}

function TeamBlock({ id, role, team, other, onChange }: {
  id: string
  role: string
  team: Team
  other: TeamColor
  onChange: (t: Team) => void
}) {
  return (
    <div className="grid content-start gap-3 bg-gray-1 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <TeamPlate color={team.color} name={team.name || role} />
        <span className="ml-auto shrink-0 t1 uppercase text-gray-10">{role}</span>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id}>{role} name</Label>
        <Input id={id} required value={team.name} onChange={e => onChange({ ...team, name: e.target.value })} />
      </div>
      <p className="t1 text-gray-10">
        Board code <span className="fig fig-3 text-gray-11">{teamCode(team.name || role)}</span>
      </p>
      <ColourGrid value={team.color} other={other} label={`${role} colour`} onChange={color => onChange({ ...team, color })} />
    </div>
  )
}

// The room's view, at 120px. Nothing here is a board token: the board is sized in cqh
// against its own stage and this is a still life of it inside a console dialog.
function HeroPreview({ a, b }: { a: Team; b: Team }) {
  const half = (team: Team, right: boolean) => (
    <div className={cn('grid min-w-0 content-start gap-2', right && 'justify-items-end text-right')}>
      <span aria-hidden style={teamStyle(team.color)} className="h-1 w-full bg-[var(--team)]" />
      <TeamPlate color={team.color} name={team.name || (right ? 'Team B' : 'Team A')} size="scorer" />
      <span className="fig fig-2 t7 text-gray-12">0</span>
    </div>
  )
  return (
    <div className="grid gap-2">
      <span className="t1 uppercase text-gray-10">The room's view</span>
      <div aria-hidden className="grid h-[120px] grid-cols-[1fr_24px_1fr] bg-background p-3">
        {half(a, false)}
        <span />
        {half(b, true)}
      </div>
    </div>
  )
}

export function NewEventDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (d: EventDetail) => void }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [mode, setMode] = useState<EventMode>('live')
  const [matCount, setMatCount] = useState('1')
  const [teamA, setTeamA] = useState<Team>({ name: '', color: 'red' })
  const [teamB, setTeamB] = useState<Team>({ name: '', color: 'blue' })
  const [maxAgeGap, setMaxAgeGap] = useState('1')
  const [maxWeightGap, setMaxWeightGap] = useState('10')
  const [sameGender, setSameGender] = useState(false)
  const create = useAdminMutation(null, (body: unknown) => adminApi<EventDetail>('/api/events', { method: 'POST', body }))

  // Opening the dialog is the only thing that resets the form, so the deps stay at [open]:
  // the setters are stable and re-running on a changed create.reset would wipe live input.
  useEffect(() => {
    if (!open) return
    setName('')
    setDate(today())
    setMode('live')
    setMatCount('1')
    setTeamA({ name: '', color: 'red' })
    setTeamB({ name: '', color: 'blue' })
    setMaxAgeGap('1')
    setMaxWeightGap('10')
    setSameGender(false)
    create.reset()
  }, [open])

  const mats = whole(matCount, 1, 8)
  const ageGap = whole(maxAgeGap, 0, 10)
  const weightGap = whole(maxWeightGap, 0, 100)
  const counts = mats !== null && ageGap !== null && weightGap !== null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!counts) return
    create.mutate({ name, date, mode, matCount: mats, teams: [teamA, teamB], maxAgeGap: ageGap, maxWeightGap: weightGap, sameGender }, {
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
          <DialogHeader><DialogTitle>New event</DialogTitle></DialogHeader>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <TeamBlock id="team-a" role="Team A" team={teamA} other={teamB.color} onChange={setTeamA} />
              <TeamBlock id="team-b" role="Team B" team={teamB} other={teamA.color} onChange={setTeamB} />
            </div>
            <HeroPreview a={teamA} b={teamB} />

            <div className="grid gap-4 sm:grid-cols-3">
              <CountField id="mats" label="Mats" value={matCount} min={1} max={8} onChange={setMatCount} />
              <CountField id="age-gap" label="Max age gap (years)" value={maxAgeGap} min={0} max={10} onChange={setMaxAgeGap} />
              <CountField id="weight-gap" label="Max weight gap (lb)" value={maxWeightGap} min={0} max={100} onChange={setMaxWeightGap} />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="same-gender" checked={sameGender} onCheckedChange={v => setSameGender(v)} />
              <Label htmlFor="same-gender" className="text-gray-11">Pair only competitors of the same gender</Label>
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
            <Button type="submit" disabled={!counts || create.isPending}>Create event</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
