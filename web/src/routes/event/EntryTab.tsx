import { useMemo, useRef, useState, type FormEvent, type Ref } from 'react'
import type { WinType } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { newEventId } from '@/lib/ids'
import type { AthleteRow, EventDetail, MatchRow } from '@/lib/types'
import { athleteName, winTypeLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { defaultOutcome } from './entry-defaults'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segment } from '@/components/ui/segment'
import { List, ListRow } from '@/components/ui/list'
import { TeamDot } from '@/components/TeamDot'

interface Form {
  aId: string
  bId: string
  pointsA: string
  pointsB: string
  winner: 'a' | 'b' | null
  winType: WinType
  touched: boolean
  editingId: number | null
  entryId: string
}

// entryId is minted once per form fill and reused on a retry, so the server dedupes a double submit.
const fresh = (): Form => ({ aId: '', bId: '', pointsA: '', pointsB: '', winner: null, winType: 'points', touched: false, editingId: null, entryId: newEventId() })

const WIN_TYPES: { value: WinType; label: string }[] = [
  { value: 'points', label: 'On points' },
  { value: 'submission', label: 'By submission' },
  { value: 'decision', label: 'By decision' },
]
const WIN_TYPE_SHORT: Record<WinType, string> = { points: 'Points', submission: 'Submission', decision: 'Decision' }

interface NewEntryBody { entryId: string; athleteAId: number; athleteBId: number; pointsA: number; pointsB: number; winnerAthleteId: number; winType: WinType }
interface CorrectionBody { entryId: string; pointsA: number; pointsB: number; winnerAthleteId: number; winType: WinType }

export function EntryTab({ detail }: { detail: EventDetail }) {
  const eventId = detail.event.id
  const [teamA, teamB] = detail.teams
  const [f, setF] = useState<Form>(fresh)
  const [saved, setSaved] = useState<string | null>(null)
  const firstField = useRef<HTMLSelectElement>(null)
  const byId = useMemo(() => new Map(detail.athletes.map(a => [a.id, a])), [detail.athletes])
  const kidsOf = (teamId: number) => detail.athletes.filter(a => a.teamId === teamId).sort((x, y) => x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName))
  const kidsA = kidsOf(teamA.id)
  const kidsB = kidsOf(teamB.id)

  const pA = f.pointsA === '' ? 0 : Number(f.pointsA)
  const pB = f.pointsB === '' ? 0 : Number(f.pointsB)
  const auto = defaultOutcome(pA, pB)
  const winner = f.touched ? f.winner : auto.winner
  const winType = f.touched ? f.winType : auto.winType
  const a = f.aId ? byId.get(Number(f.aId)) : undefined
  const b = f.bId ? byId.get(Number(f.bId)) : undefined
  const canSave = !!a && !!b && winner !== null

  const create = useAdminMutation(eventId, (body: NewEntryBody) => adminApi(`/api/events/${eventId}/entries`, { method: 'POST', body }))
  const correct = useAdminMutation(eventId, (v: { id: number; body: CorrectionBody }) => adminApi(`/api/matches/${v.id}/entry`, { method: 'POST', body: v.body }))
  const start = useAdminMutation<void>(eventId, () => adminApi(`/api/events/${eventId}`, { method: 'PATCH', body: { status: 'live' } }))

  // A points edit alone never resets touched: auto-derivation from points only
  // drives the suggestion until the organizer picks a winner or a win type (or
  // loads a match to correct); after that the pick sticks until Save or Cancel edit.
  const setPoints = (key: 'pointsA' | 'pointsB') => (v: string) => setF(s => ({ ...s, [key]: v.replace(/\D/g, '') }))
  const pickWinner = (w: 'a' | 'b') => setF(s => {
    const nextWinType = s.touched ? s.winType : (defaultOutcome(pA, pB).winner === null ? 'decision' : defaultOutcome(pA, pB).winType)
    return { ...s, winner: w, winType: nextWinType, touched: true }
  })
  const pickType = (t: WinType) => setF(s => ({ ...s, winner, winType: t, touched: true }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!a || !b || winner === null) return
    const winnerAthleteId = winner === 'a' ? a.id : b.id
    const loser = winner === 'a' ? b : a
    const message = `Saved: ${athleteName(winner === 'a' ? a : b)} beat ${athleteName(loser)} ${winTypeLabel(winType)}, ${pA} to ${pB}`
    const onSaved = () => {
      setSaved(message)
      setF(fresh())
      firstField.current?.focus()
    }
    if (f.editingId !== null) {
      const body: CorrectionBody = { entryId: f.entryId, pointsA: pA, pointsB: pB, winnerAthleteId, winType }
      correct.mutate({ id: f.editingId, body }, { onSuccess: onSaved })
    } else {
      const body: NewEntryBody = { entryId: f.entryId, athleteAId: a.id, athleteBId: b.id, pointsA: pA, pointsB: pB, winnerAthleteId, winType }
      create.mutate(body, { onSuccess: onSaved })
    }
  }

  const load = (m: MatchRow) => {
    const w = m.winnerAthleteId === m.athleteAId ? 'a' : 'b'
    setF({
      aId: String(m.athleteAId), bId: String(m.athleteBId),
      pointsA: String(m.pointsA), pointsB: String(m.pointsB),
      winner: w, winType: m.winType ?? 'points',
      touched: true, editingId: m.id, entryId: newEventId(),
    })
    setSaved(null)
  }
  const use = (m: MatchRow) => setF({ ...fresh(), aId: String(m.athleteAId), bId: String(m.athleteBId) })

  const done = detail.matches.filter(m => m.status === 'done').sort((x, y) => y.id - x.id)
  const pending = detail.matches.filter(m => m.status === 'pending').sort((x, y) => x.orderIndex - y.orderIndex)
  const name = (id: number) => { const k = byId.get(id); return k ? athleteName(k) : 'Unknown' }
  const error = create.error ?? correct.error ?? start.error

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {detail.event.status === 'setup' && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 pl-3.5 lg:col-span-2">
          <p className="text-soft">The board shows this event as in progress once you start it.</p>
          <Button size="sm" className="ml-auto" onClick={() => start.mutate()} disabled={start.isPending}>Start event</Button>
        </div>
      )}
      <div className="grid gap-4">
        <form onSubmit={submit} className="grid gap-4 rounded-lg border border-border bg-card p-4">
          {/*
            One flat grid, not two nested per-team grids: spec 9.2 fixes the tab
            order (competitor A, competitor B, points A, points B, winner A,
            winner B, win type, save), so every field is placed here via explicit
            grid-column and grid-row, and DOM order matches the required tab
            order while the column-start/row-start placement recreates the
            two-column look.
          */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <TeamHead color={teamA.color} name={teamA.name} role="Team A" className="sm:col-start-1 sm:row-start-1" />
            <span aria-hidden className="text-xs text-faint sm:col-start-2 sm:row-span-4 sm:row-start-1 sm:self-center sm:justify-self-center">vs</span>
            <TeamHead color={teamB.color} name={teamB.name} role="Team B" className="sm:col-start-3 sm:row-start-1" />

            <KidSelect
              id="a-kid" label={`${teamA.name} competitor`} kids={kidsA} value={f.aId}
              onChange={v => setF(s => ({ ...s, aId: v }))} selectRef={firstField}
              className="sm:col-start-1 sm:row-start-2"
            />
            <KidSelect
              id="b-kid" label={`${teamB.name} competitor`} kids={kidsB} value={f.bId}
              onChange={v => setF(s => ({ ...s, bId: v }))}
              className="sm:col-start-3 sm:row-start-2"
            />

            <PointsField id="a-points" label={`${teamA.name} points`} value={f.pointsA} onChange={setPoints('pointsA')} className="sm:col-start-1 sm:row-start-3" />
            <PointsField id="b-points" label={`${teamB.name} points`} value={f.pointsB} onChange={setPoints('pointsB')} className="sm:col-start-3 sm:row-start-3" />

            <WinnerButton kid={a} color={teamA.color} pressed={winner === 'a'} onClick={() => pickWinner('a')} className="sm:col-start-1 sm:row-start-4" />
            <WinnerButton kid={b} color={teamB.color} pressed={winner === 'b'} onClick={() => pickWinner('b')} className="sm:col-start-3 sm:row-start-4" />
          </div>
          <Segment value={winType} onValueChange={v => pickType(v as WinType)} options={WIN_TYPES} aria-label="Win type" />
          {winner === null && a && b && <p className="text-[13px] text-faint">Scores are tied. Pick the winner.</p>}
          {error && <p role="alert" className="text-[13px] text-destructive">{error.message}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" size="lg" disabled={!canSave || create.isPending || correct.isPending}>
              {f.editingId !== null ? 'Save correction' : 'Save result'}
            </Button>
            {f.editingId !== null && <Button type="button" variant="ghost" onClick={() => setF(fresh())}>Cancel edit</Button>}
            {saved && <span aria-live="polite" className="text-[13px] text-faint">{saved}</span>}
          </div>
        </form>
        {pending.length > 0 && (
          <section aria-label="Pending pairs" className="grid gap-2">
            <h3 className="label">Pending pairs</h3>
            <List>
              {pending.map(m => (
                <ListRow key={m.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{name(m.athleteAId)} vs {name(m.athleteBId)}</span>
                  {m.why && <span className="text-xs text-faint">{m.why}</span>}
                  <Button size="sm" variant="secondary" onClick={() => use(m)}>Use</Button>
                </ListRow>
              ))}
            </List>
          </section>
        )}
      </div>
      <section aria-label="Results" className="grid gap-2">
        <h3 className="label">Results ({done.length})</h3>
        {done.length === 0 ? (
          <p className="text-[13px] text-faint">No results yet.</p>
        ) : (
          <List>
            {done.map(m => {
              const aWon = m.winnerAthleteId === m.athleteAId
              const bWon = m.winnerAthleteId === m.athleteBId
              return (
                <ListRow key={m.id} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-3">
                  <div className={cn('flex min-w-0 items-center gap-2 font-medium', !aWon && 'font-normal text-faint')}>
                    <TeamDot color={teamA.color} />
                    <span className="truncate">{name(m.athleteAId)}</span>
                    <span className="font-mono tabular text-soft">{m.pointsA}</span>
                  </div>
                  <span className="min-w-[84px] text-center text-xs text-muted-foreground">{m.winType ? WIN_TYPE_SHORT[m.winType] : ''}</span>
                  <div className={cn('flex min-w-0 items-center justify-end gap-2 font-medium', !bWon && 'font-normal text-faint')}>
                    <span className="font-mono tabular text-soft">{m.pointsB}</span>
                    <span className="truncate">{name(m.athleteBId)}</span>
                    <TeamDot color={teamB.color} />
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => load(m)}>Edit</Button>
                </ListRow>
              )
            })}
          </List>
        )}
      </section>
    </div>
  )
}

function TeamHead({ color, name, role, className }: { color: string; name: string; role: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <TeamDot color={color} name={name} />
      <span className="ml-auto shrink-0 text-xs text-faint">{role}</span>
    </div>
  )
}

function KidSelect({ id, label, kids, value, onChange, selectRef, className }: {
  id: string
  label: string
  kids: AthleteRow[]
  value: string
  onChange: (v: string) => void
  selectRef?: Ref<HTMLSelectElement>
  className?: string
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        ref={selectRef}
        required
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-[color,background-color,box-shadow] duration-150 focus-visible:border-transparent focus-visible:shadow-focus"
      >
        <option value="">Pick a competitor</option>
        {kids.map(k => <option key={k.id} value={k.id}>{athleteName(k)}</option>)}
      </select>
    </div>
  )
}

function PointsField({ id, label, value, onChange, className }: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={99}
        inputMode="numeric"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-[72px] rounded-lg bg-background text-center font-mono text-[40px] font-medium tabular"
      />
    </div>
  )
}

function WinnerButton({ kid, color, pressed, onClick, className }: { kid: AthleteRow | undefined; color: string; pressed: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={!kid}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium text-soft shadow-[0_0_0_1px_#2f3037] transition-[color,background-color,box-shadow] duration-150 focus-visible:shadow-focus aria-pressed:bg-secondary aria-pressed:text-foreground aria-pressed:shadow-ring disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
    >
      {kid && <TeamDot color={color} />}
      <span>{kid ? `${athleteName(kid)} wins` : 'Pick a competitor first'}</span>
    </button>
  )
}
