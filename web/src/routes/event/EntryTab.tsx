import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { PencilLine } from 'lucide-react'
import { teamCode, type WinType } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { newEventId } from '@/lib/ids'
import type { AthleteRow, EventDetail, MatchRow, TeamRow } from '@/lib/types'
import { athleteName, winTypeLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { defaultOutcome } from './entry-defaults'
import {
  CUE_MS, LEDGER_LIMIT, RESTORED_NEW_ENTRY, SAVED_LABEL_MS, SAVE_TIMEOUT_MS,
  clearDraft, clockLabel, isRepeatPair, ledgerTime, loadDraft, pairKey, restoreDraft, restoredBannerCopy, saveDraft, saveErrorCopy, teamWins,
  type EntryDraft, type SaveErrorCopy,
} from './entry-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { List, ListRow } from '@/components/ui/list'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { TeamPlate } from '@/components/TeamPlate'

interface Form extends EntryDraft { touched: boolean }

// The entryId is minted when the form opens and held through every attempt,
// including retries and a reload, so the server dedupes a resend. Only a 2xx
// mints the next one.
const fresh = (): Form => ({
  entryId: newEventId(), aId: '', bId: '', pointsA: '', pointsB: '',
  winner: null, winType: 'points', touched: false, editingId: null,
})

const draftOf = (f: Form): EntryDraft => ({
  entryId: f.entryId, aId: f.aId, bId: f.bId, pointsA: f.pointsA, pointsB: f.pointsB,
  winner: f.winner, winType: f.winType, editingId: f.editingId,
})

const WIN_TYPES: { value: WinType; label: string; hint: string }[] = [
  { value: 'points', label: 'On points', hint: 'P' },
  { value: 'submission', label: 'By submission', hint: 'S' },
  { value: 'decision', label: 'By decision', hint: 'D' },
]
const WIN_TYPE_WORD: Record<WinType, string> = { points: 'Points', submission: 'Submission', decision: 'Decision' }
const WIN_TYPE_KEY: Record<string, WinType> = { p: 'points', s: 'submission', d: 'decision' }

// One set of tracks for the head and every row: name, points, the win type as a
// word, points, name, time, one action. Every numeric track is a Ledger Grid token
// (2.7) so a score sits in the same register here as on Roster, Matches and Live.
// Declared on a mono element or ch measures the sans zero and the head stops lining
// up with its own digits.
const LEDGER_COLS =
  'grid grid-cols-[minmax(0,1fr)_var(--col-num-s)_88px_var(--col-num-s)_minmax(0,1fr)_var(--col-num-l)_var(--col-act)] items-center gap-x-3 px-3 font-mono t2'

interface NewEntryBody { entryId: string; athleteAId: number; athleteBId: number; pointsA: number; pointsB: number; winnerAthleteId: number; winType: WinType }
interface CorrectionBody { entryId: string; pointsA: number; pointsB: number; winnerAthleteId: number; winType: WinType }
interface EntryResponse { match?: { id?: number } | null; version?: number }

export function EntryTab({ detail }: { detail: EventDetail }) {
  const eventId = detail.event.id
  const [teamA, teamB] = detail.teams
  const [f, setF] = useState<Form>(() => {
    const draft = restoreDraft(eventId)
    return draft ? { ...draft, touched: draft.winner !== null } : fresh()
  })
  const [failure, setFailure] = useState<SaveErrorCopy | null>(() => {
    const restored = restoreDraft(eventId)
    return restored ? restoredBannerCopy(restored, detail.matches, detail.athletes) : null
  })
  const [pairPrompt, setPairPrompt] = useState<string | null>(null)
  const [savedLabel, setSavedLabel] = useState(false)
  const [announce, setAnnounce] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  const [savedAt, setSavedAt] = useState<Record<number, number>>({})
  const [cue, setCue] = useState<{ id: number; on: boolean } | null>(null)
  const pairLog = useRef<Record<string, number>>({})
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)) }
  useEffect(() => () => {
    for (const t of timers.current) clearTimeout(t)
    if (watchdog.current) clearTimeout(watchdog.current)
  }, [])

  const byId = useMemo(() => new Map(detail.athletes.map(a => [a.id, a])), [detail.athletes])
  const kidsOf = (teamId: number) => detail.athletes
    .filter(a => a.teamId === teamId)
    .sort((x, y) => x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName))
  const kidsA = kidsOf(teamA.id)
  const kidsB = kidsOf(teamB.id)

  const pA = f.pointsA === '' ? 0 : Number(f.pointsA)
  const pB = f.pointsB === '' ? 0 : Number(f.pointsB)
  const auto = defaultOutcome(pA, pB)
  const winner = f.touched ? f.winner : auto.winner
  const winType = f.touched ? f.winType : auto.winType
  const a = f.aId ? byId.get(Number(f.aId)) : undefined
  const b = f.bId ? byId.get(Number(f.bId)) : undefined

  const create = useAdminMutation(eventId, (body: NewEntryBody) => adminApi<EntryResponse>(`/api/events/${eventId}/entries`, { method: 'POST', body }))
  const correct = useAdminMutation(eventId, (v: { id: number; body: CorrectionBody }) => adminApi<EntryResponse>(`/api/matches/${v.id}/entry`, { method: 'POST', body: v.body }))
  const start = useAdminMutation<void>(eventId, () => adminApi(`/api/events/${eventId}`, { method: 'PATCH', body: { status: 'live' } }))

  // Every terminal outcome re-enables Save, the watchdog included, because a POST
  // that never answers must not leave a reload as the only way out.
  const inFlight = (create.isPending || correct.isPending) && !timedOut
  const canSave = !!a && !!b && winner !== null
  const wins = useMemo(() => teamWins(detail.matches, detail.athletes), [detail.matches, detail.athletes])
  const winsA = wins.get(teamA.id) ?? 0
  const winsB = wins.get(teamB.id) ?? 0

  // A points edit alone never resets touched: auto-derivation from points only
  // drives the suggestion until the organizer picks a winner or a win type (or
  // loads a match to correct); after that the pick sticks until Save or Cancel edit.
  const setPoints = (key: 'pointsA' | 'pointsB') => (v: string) => setF(s => ({ ...s, [key]: v.replace(/\D/g, '').slice(0, 2) }))
  const pickKid = (key: 'aId' | 'bId') => (v: string) => {
    setPairPrompt(null)
    setF(s => ({ ...s, [key]: v }))
  }
  const pickWinner = (w: 'a' | 'b') => setF(s => {
    const nextWinType = s.touched ? s.winType : (defaultOutcome(pA, pB).winner === null ? 'decision' : defaultOutcome(pA, pB).winType)
    return { ...s, winner: w, winType: nextWinType, touched: true }
  })
  const pickType = (t: WinType) => setF(s => ({ ...s, winner, winType: t, touched: true }))

  const focusFirstField = () => formRef.current?.querySelector<HTMLElement>('#entry-a-competitor')?.focus()
  const focusPoints = () => {
    const well = formRef.current?.querySelector<HTMLInputElement>('#entry-a-points')
    well?.focus()
    well?.select()
  }

  const settle = () => {
    if (watchdog.current) clearTimeout(watchdog.current)
    watchdog.current = null
  }

  // Leaving a correction, by saving it or by cancelling it, hands the desk back the
  // unsent new entry that correction interrupted, banner and all. The two drafts
  // live in separate slots, so the one that was never sent is still there to restore.
  const resume = (editingId: number | null) => {
    const kept = editingId === null ? null : loadDraft(eventId)
    if (!kept) {
      setF(fresh())
      setFailure(null)
      return
    }
    setF({ ...kept, touched: kept.winner !== null })
    setFailure(RESTORED_NEW_ENTRY)
  }

  const onSaved = (res: EntryResponse | undefined, key: string, sentence: string, payload: Form) => {
    settle()
    clearDraft(eventId, payload.editingId)
    pairLog.current[key] = Date.now()
    const id = res?.match?.id
    if (typeof id === 'number') {
      const at = Date.now()
      setSavedAt(s => ({ ...s, [id]: at }))
      setCue({ id, on: true })
    }
    setPairPrompt(null)
    setTimedOut(false)
    setSavedLabel(true)
    setAnnounce(sentence)
    later(() => setSavedLabel(false), SAVED_LABEL_MS)
    resume(payload.editingId)
    focusFirstField()
  }

  const onFailed = (payload: Form, error: unknown) => {
    settle()
    saveDraft(eventId, draftOf(payload))
    setFailure(saveErrorCopy(error))
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!a || !b || winner === null || inFlight) return
    const key = pairKey(a.id, b.id)
    if (f.editingId === null && pairPrompt !== key && isRepeatPair(pairLog.current, key, Date.now())) {
      setPairPrompt(key)
      return
    }
    const winnerAthleteId = winner === 'a' ? a.id : b.id
    const won = winner === 'a' ? a : b
    const lost = winner === 'a' ? b : a
    const sentence = `Saved. ${athleteName(won)} beat ${athleteName(lost)} ${winTypeLabel(winType)}, ${pA} to ${pB}.`
    const payload = f

    setTimedOut(false)
    settle()
    watchdog.current = setTimeout(() => {
      setTimedOut(true)
      onFailed(payload, new Error('timeout'))
    }, SAVE_TIMEOUT_MS)

    if (f.editingId !== null) {
      const body: CorrectionBody = { entryId: f.entryId, pointsA: pA, pointsB: pB, winnerAthleteId, winType }
      correct.mutate({ id: f.editingId, body }, {
        onSuccess: res => onSaved(res, key, sentence, payload),
        onError: err => onFailed(payload, err),
      })
    } else {
      const body: NewEntryBody = { entryId: f.entryId, athleteAId: a.id, athleteBId: b.id, pointsA: pA, pointsB: pB, winnerAthleteId, winType }
      create.mutate(body, {
        onSuccess: res => onSaved(res, key, sentence, payload),
        onError: err => onFailed(payload, err),
      })
    }
  }

  // Single keys on top of the tab order. Letters are read even inside a points
  // well, which takes digits only, so the operator never has to leave the well
  // to name a winner. The Select owns its own typeahead and is left alone.
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const el = e.target as HTMLElement
    if (el.closest('[data-slot="select-trigger"], [data-slot="select-content"]')) return
    const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    if (e.key === 'Enter' && typing) { e.preventDefault(); submit(); return }
    if (/^\d$/.test(e.key) && !typing) {
      e.preventDefault()
      setPoints('pointsA')(e.key)
      formRef.current?.querySelector<HTMLInputElement>('#entry-a-points')?.focus()
      return
    }
    const k = e.key.toLowerCase()
    if (k === 'a' || k === 'b') {
      if ((k === 'a' && !a) || (k === 'b' && !b)) return
      e.preventDefault()
      pickWinner(k)
      return
    }
    if (k in WIN_TYPE_KEY) {
      e.preventDefault()
      pickType(WIN_TYPE_KEY[k])
    }
  }

  // The banner goes while the correction is on screen because it describes the other
  // entry, not this one. The entry itself stays in its own slot and comes back with
  // its banner the moment the correction is saved or cancelled.
  const load = (m: MatchRow) => {
    // R5: switching straight from one correction to another, without pressing
    // Cancel edit, must not strand the outgoing one. Clear its slot the same
    // way cancelEdit does, or a failed save on it survives in storage forever
    // and later restores wearing a banner that looks like an unsent new entry.
    if (f.editingId !== null && f.editingId !== m.id) clearDraft(eventId, f.editingId)
    setF({
      aId: String(m.athleteAId), bId: String(m.athleteBId),
      pointsA: String(m.pointsA), pointsB: String(m.pointsB),
      winner: m.winnerAthleteId === m.athleteAId ? 'a' : 'b', winType: m.winType ?? 'points',
      touched: true, editingId: m.id, entryId: newEventId(),
    })
    setFailure(null)
    setPairPrompt(null)
    setAnnounce('')
    focusPoints()
  }
  // The other door out of a correction, and it strands the same way load did:
  // leaving a correction for a fresh entry must close the correction's slot, or a
  // failed save on it survives and later restores as an entry nobody typed.
  const use = (m: MatchRow) => {
    if (f.editingId !== null) clearDraft(eventId, f.editingId)
    setPairPrompt(null)
    setFailure(null)
    setF({ ...fresh(), aId: String(m.athleteAId), bId: String(m.athleteBId) })
    focusPoints()
  }
  // Cancelling an edit drops that correction's own draft: a correction sets one
  // match's result rather than creating a win, so re-sending it under a new id
  // cannot double anything, and a kept draft would reappear on the next load as
  // an entry nobody meant to make. It never touches the new-entry slot.
  const cancelEdit = () => {
    clearDraft(eventId, f.editingId)
    setPairPrompt(null)
    resume(f.editingId)
  }

  // Instant on, released over 600ms, exactly once. The release waits a beat so
  // the row that just landed paints the highlight before it starts to fade.
  useEffect(() => {
    if (!cue?.on) return
    const id = cue.id
    const on = setTimeout(() => setCue(c => (c && c.id === id ? { id, on: false } : c)), 50)
    const off = setTimeout(() => setCue(c => (c && c.id === id ? null : c)), 50 + CUE_MS)
    return () => { clearTimeout(on); clearTimeout(off) }
  }, [cue])

  const done = useMemo(() => detail.matches.filter(m => m.status === 'done').sort((x, y) => y.id - x.id), [detail.matches])
  const shown = done.slice(0, LEDGER_LIMIT)
  const pending = detail.matches.filter(m => m.status === 'pending').sort((x, y) => x.orderIndex - y.orderIndex)
  const name = (id: number) => { const k = byId.get(id); return k ? athleteName(k) : 'Unknown' }
  const startError = start.error

  return (
    <div className="grid gap-6">
      <p aria-live="polite" className="sr-only">{announce}</p>

      <section aria-label="Running team score" className="grid grid-cols-[1fr_auto_1fr] items-center gap-8 rounded-lg bg-gray-1 px-6 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <TeamPlate color={teamA.color} name={teamA.name} />
          <Figure value={winsA} lead={winsA >= winsB} />
        </div>
        <span className="t1 whitespace-nowrap text-gray-10 uppercase">Match wins</span>
        <div className="flex min-w-0 items-center justify-end gap-4">
          <Figure value={winsB} lead={winsB >= winsA} />
          <TeamPlate color={teamB.color} name={teamB.name} />
        </div>
      </section>

      {detail.event.status === 'setup' && (
        <div className="flex items-center gap-3 rounded-lg bg-gray-1 px-4 py-3">
          <p className="t2 text-gray-11">The board shows this event as in progress once you start it.</p>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => start.mutate()} disabled={start.isPending}>Start event</Button>
        </div>
      )}
      {startError && (
        <Alert>
          <AlertTitle>The event did not start</AlertTitle>
          <AlertDescription>{startError.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid gap-6">
          <form ref={formRef} onSubmit={submit} onKeyDown={onKeyDown} className="rounded-lg bg-gray-2 p-4">
            <div className="mb-1 flex items-baseline gap-3">
              <h3 className="t4">{f.editingId !== null ? 'Correct a result' : 'New result'}</h3>
              {f.editingId !== null && <span className="t2 text-attend">Editing a saved result</span>}
            </div>
            <p className="mb-4 t2 text-gray-10">Type each result as it comes off the mat. Pick both competitors, enter points, press Save.</p>

            {/*
              One flat grid, not two nested per-team grids: spec 9.2 fixes the tab
              order (competitor A, competitor B, points A, points B, winner A,
              winner B, win type, save), so every field is placed here via explicit
              grid-column and grid-row, and DOM order matches the required tab
              order while the column-start/row-start placement recreates the
              two-column look.
            */}
            <div className="grid grid-cols-1 items-end gap-x-4 gap-y-3 sm:grid-cols-[1fr_auto_1fr]">
              <KidField
                id="entry-a-competitor" team={teamA} kids={kidsA} value={f.aId} onChange={pickKid('aId')}
                className="sm:col-start-1 sm:row-start-1"
              />
              <KidField
                id="entry-b-competitor" team={teamB} kids={kidsB} value={f.bId} onChange={pickKid('bId')}
                align="right" className="sm:col-start-3 sm:row-start-1"
              />
              <span aria-hidden className="t1 hidden text-gray-9 uppercase sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:block sm:self-center">vs</span>
              <PointsField id="entry-a-points" team={teamA} value={f.pointsA} onChange={setPoints('pointsA')} digitKey className="sm:col-start-1 sm:row-start-2" />
              <PointsField id="entry-b-points" team={teamB} value={f.pointsB} onChange={setPoints('pointsB')} align="right" className="sm:col-start-3 sm:row-start-2" />

              <WinnerToggle kid={a} team={teamA} hint="A" pressed={winner === 'a'} onPress={() => pickWinner('a')} className="sm:col-start-1 sm:row-start-3" />
              <WinnerToggle kid={b} team={teamB} hint="B" pressed={winner === 'b'} onPress={() => pickWinner('b')} className="sm:col-start-3 sm:row-start-3" />
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {WIN_TYPES.map(t => (
                <Toggle
                  key={t.value}
                  pressed={winType === t.value}
                  onPressedChange={() => pickType(t.value)}
                  aria-label={t.label}
                  aria-keyshortcuts={t.hint}
                  className="w-full"
                >
                  {WIN_TYPE_WORD[t.value]}
                  <Hint>{t.hint}</Hint>
                </Toggle>
              ))}
            </div>

            {winner === null && a && b && <p className="mt-3 t2 text-gray-11">Scores are tied. Pick the winner.</p>}

            {pairPrompt !== null && (
              <Alert variant="attend" className="mt-4">
                <AlertTitle variant="attend">These two were just entered</AlertTitle>
                <AlertDescription>{a && b ? `${athleteName(a)} and ${athleteName(b)} have a result from the last minute. Press Save again to record a second one.` : 'Press Save again to record a second result.'}</AlertDescription>
              </Alert>
            )}
            {failure && (
              <Alert className="mt-4">
                <AlertTitle>{failure.title}</AlertTitle>
                <AlertDescription>{failure.body}</AlertDescription>
              </Alert>
            )}

            <div className="mt-4 flex items-center gap-3">
              <Button type="submit" size="lg" aria-keyshortcuts="Enter" disabled={!canSave || inFlight} className="flex-1">
                {savedLabel ? 'Saved' : inFlight ? 'Saving' : f.editingId !== null ? 'Save correction' : 'Save'}
                {!savedLabel && !inFlight && <Hint tone="on-white">Enter</Hint>}
              </Button>
              {f.editingId !== null && <Button type="button" variant="ghost" size="lg" onClick={cancelEdit}>Cancel edit</Button>}
            </div>
          </form>

          {pending.length > 0 && (
            <section aria-label="Pending pairs" className="grid gap-3">
              <h3 className="t4">Pending pairs</h3>
              <List>
                {pending.map(m => (
                  <ListRow key={m.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate t3">{name(m.athleteAId)} vs {name(m.athleteBId)}</span>
                    {m.why && <span className="t2 text-gray-10">{m.why}</span>}
                    <Button size="sm" variant="secondary" onClick={() => use(m)}>Use</Button>
                  </ListRow>
                ))}
              </List>
            </section>
          )}
        </div>

        <section aria-label="Results" className="overflow-hidden rounded-lg bg-gray-2">
          <div className="flex items-baseline gap-3 px-4 pt-4 pb-3">
            <h3 className="t4">Results</h3>
            <span className="ml-auto t2 text-gray-10">
              {done.length > shown.length
                ? <>Newest <span className="fig">{shown.length}</span> of <span className="fig">{done.length}</span></>
                : <><span className="fig">{done.length}</span> saved, newest first</>}
            </span>
          </div>
          <div className={cn(LEDGER_COLS, 'h-8 bg-gray-1')}>
            {/* The full name truncates to five letters here, and the code is the short
                form the plates already use everywhere else. */}
            <span className="truncate font-sans t1 text-gray-10" title={teamA.name}>{teamCode(teamA.name)}</span>
            <span className="tick text-right font-sans t1 text-gray-10 uppercase">Pts</span>
            <span className="text-center font-sans t1 text-gray-10 uppercase">Win by</span>
            <span className="tick text-right font-sans t1 text-gray-10 uppercase">Pts</span>
            <span className="truncate text-right font-sans t1 text-gray-10" title={teamB.name}>{teamCode(teamB.name)}</span>
            <span className="text-right font-sans t1 text-gray-10 uppercase">At</span>
            <span className="sr-only">Edit</span>
          </div>
          {shown.length === 0
            ? <EmptyState message="No results yet. Type the first one on the left." />
            : shown.map(m => (
              <LedgerRow
                key={m.id}
                match={m}
                nameA={name(m.athleteAId)}
                nameB={name(m.athleteBId)}
                at={ledgerTime(m.endedAt, savedAt[m.id])}
                cued={cue?.id === m.id && cue.on}
                cueing={cue?.id === m.id}
                onEdit={() => load(m)}
              />
            ))}
        </section>
      </div>
    </div>
  )
}

// 7.5: the whole numeral crossfades, 100ms, and never moves. The resting colour
// is the leading or trailing figure token, which is the only thing separating
// the two numbers.
function Figure({ value, lead }: { value: number; lead: boolean }) {
  const [shown, setShown] = useState(value)
  const [fading, setFading] = useState(false)
  useEffect(() => {
    if (value === shown) return
    setFading(true)
    const t = setTimeout(() => { setShown(value); setFading(false) }, 100)
    return () => clearTimeout(t)
  }, [value, shown])
  return (
    <span
      className={cn(
        'fig fig-2 inline-block t7 text-center transition-opacity duration-100 ease-out',
        lead ? 'text-fig-lead' : 'text-fig-trail',
        fading ? 'opacity-0' : 'opacity-100',
      )}
    >
      {shown}
    </span>
  )
}

function Hint({ children, tone = 'on-dark' }: { children: ReactNode; tone?: 'on-dark' | 'on-white' }) {
  // aria-hidden because the accessible name stays the verb; the key itself is
  // published to assistive technology as aria-keyshortcuts on the control.
  //
  // 6.6 requires --gray-10 for a shortcut hint because it is text a person reads,
  // and the ramp is authored for dark surfaces, so on the primary button's white
  // fill --gray-10 is 3.00:1 and --gray-9 is 3.96:1, both under the 4.5:1 floor at
  // 13px. The on-white tone takes the same rung of the ramp measured the other way:
  // --gray-7 is 8.9:1 on white, and it is never a line here.
  return <span aria-hidden className={cn('font-mono t2', tone === 'on-white' ? 'text-gray-7' : 'text-gray-10')}>{children}</span>
}

function KidField({ id, team, kids, value, onChange, align = 'left', className }: {
  id: string
  team: TeamRow
  kids: AthleteRow[]
  value: string
  onChange: (v: string) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const items = kids.map(k => ({ value: String(k.id), label: athleteName(k) }))
  return (
    <div className={cn('grid gap-1.5', className)}>
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

// The well is one of the app's signature objects: 88px, black fill, radius 0
// because inner = max(0, 8 - 16) = 0 inside a padded field, one t8 numeral in a
// two character slot so 9 and 12 occupy the same box. The numeral is --gray-12,
// not --white: 2.1 gives white to text at 24px and below, and t8 is 44px, where
// pure white halates on an emissive panel.
//
// The digit key only ever fills this side, so only this side carries the hint. A
// digit typed while focus is in the other well is the browser's own typing, not
// the shortcut, and needs no hint to explain it.
function PointsField({ id, team, value, onChange, digitKey = false, align = 'left', className }: {
  id: string
  team: TeamRow
  value: string
  onChange: (v: string) => void
  digitKey?: boolean
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className={cn('flex items-center gap-2', align === 'right' && 'flex-row-reverse')}>
        <Label htmlFor={id}>{team.name} points</Label>
        {digitKey && <Hint>0 to 9</Hint>}
      </div>
      <div className="grid h-[88px] place-items-center border border-gray-7 bg-background focus-within:shadow-focus">
        <input
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          maxLength={2}
          placeholder="0"
          aria-keyshortcuts={digitKey ? '0 1 2 3 4 5 6 7 8 9' : undefined}
          className="fig fig-2 w-full bg-transparent text-center t8 text-gray-12 outline-none placeholder:text-gray-9"
        />
      </div>
    </div>
  )
}

function WinnerToggle({ kid, team, hint, pressed, onPress, className }: {
  kid: AthleteRow | undefined
  team: TeamRow
  hint: string
  pressed: boolean
  onPress: () => void
  className?: string
}) {
  return (
    <Toggle
      pressed={pressed}
      onPressedChange={onPress}
      disabled={!kid}
      aria-keyshortcuts={hint}
      className={cn('w-full', className)}
    >
      <span className="truncate">{kid ? `${athleteName(kid)} wins` : `Pick a ${team.name} competitor first`}</span>
      <Hint>{hint}</Hint>
    </Toggle>
  )
}

// The paper sheet's row: the winner carries its own mark on whichever side it
// falls, the win type is a word, and the loser is --gray-10 at 400 and never
// red, because red means delete in this app.
function LedgerRow({ match, nameA, nameB, at, cued, cueing, onEdit }: {
  match: MatchRow
  nameA: string
  nameB: string
  at: Date | null
  cued: boolean
  cueing: boolean
  onEdit: () => void
}) {
  const aWon = match.winnerAthleteId === match.athleteAId
  const winnerName = aWon ? nameA : nameB
  const loserName = aWon ? nameB : nameA
  return (
    <div
      className={cn(
        LEDGER_COLS, 'h-10 border-t border-gray-7',
        cueing && 'transition-colors duration-600 ease-out',
        cued ? 'bg-gray-6' : 'bg-transparent',
      )}
    >
      <span data-side="a" data-outcome={aWon ? 'win' : 'loss'} className={cn('flex min-w-0 items-center font-sans t3', aWon ? 'font-medium text-white' : 'text-gray-10')}>
        {aWon && <Mark side="left" />}
        <span className="truncate">{nameA}</span>
      </span>
      <span className={cn('fig text-right', aWon ? 'text-white' : 'text-gray-10')}>{match.pointsA}</span>
      <span className="truncate text-center font-sans t2 text-gray-10">{match.winType ? WIN_TYPE_WORD[match.winType] : ''}</span>
      <span className={cn('fig text-right', aWon ? 'text-gray-10' : 'text-white')}>{match.pointsB}</span>
      <span data-side="b" data-outcome={aWon ? 'loss' : 'win'} className={cn('flex min-w-0 items-center justify-end font-sans t3', aWon ? 'text-gray-10' : 'font-medium text-white')}>
        <span className="truncate">{nameB}</span>
        {!aWon && <Mark side="right" />}
      </span>
      <span className="text-right t1 text-gray-10">{at === null ? '' : clockLabel(at)}</span>
      {/*
        xs carries a 44px hit area as a 28px control plus an 8px pseudo-element
        inset, which is 4px taller than this 40px rung and would sit on top of the
        rows above and below. The vertical reach is clamped to the row; the
        horizontal reach keeps the full 44px.
      */}
      <Button
        variant="ghost"
        size="xs"
        title="Edit result"
        aria-label={`Edit ${winnerName} over ${loserName}`}
        onClick={onEdit}
        className="before:-top-1.5 before:-bottom-1.5"
      >
        <PencilLine />
      </Button>
    </div>
  )
}

function Mark({ side }: { side: 'left' | 'right' }) {
  return (
    <>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full bg-gray-12', side === 'left' ? 'mr-1.5' : 'ml-1.5')} />
      <span className="sr-only">Winner</span>
    </>
  )
}
