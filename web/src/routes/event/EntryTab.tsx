import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { History, PencilLine } from 'lucide-react'
import { teamCode, type WinType } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { focusWithoutEngaging } from '@/lib/operatorEngaged'
import { sortDoneMatches } from '@/lib/matchOrder'
import { CERTIFIED_ENTRY_LINE, FINISHED_LINE, MAT_NOTE, isFinished, modeOf, statusOf } from '@/lib/eventMode'
import { useSnapshot } from '@/lib/useSnapshot'
import { newEventId } from '@/lib/ids'
import type { AthleteRow, EventDetail, MatchRow, TeamRow } from '@/lib/types'
import { athleteName, winTypeLabel } from '@/lib/format'
import { matchViewOf } from '@/lib/matchView'
import { matchLines } from './matches-view'
import { cn } from '@/lib/utils'
import { defaultOutcome } from './entry-defaults'
import {
  CUE_MS, LEDGER_LIMIT, RESTORED_NEW_ENTRY, RETRY_INTERVAL_MS, SAVED_LABEL_MS, SAVE_TIMEOUT_MS,
  clearDraft, clockLabel, duplicateCopy, entryShape, isRepeatPair, ledgerTime, loadDraft, outcomeMatches,
  pairKey, restoreDraft, restoredBannerCopy, retriesItself, saveDraft, saveErrorCopy, seedPairLog, serverRefused,
  storedOutcome, teamWins,
  type EntryDraft, type EntryMatch, type SaveErrorCopy,
} from './entry-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { List, ListRow } from '@/components/ui/list'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { TeamPlate } from '@/components/TeamPlate'
import { FinishEventDialog } from './FinishEventDialog'
import { MatchHistorySheet } from './MatchHistorySheet'
import { matchHistorySource, type HistorySource } from './match-history'
import { ResultDialog } from './ResultDialog'

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

// G30. A 5 to 2 match won by the side with 2 recorded as won on points and nothing said
// so. The pick is never refused: kids submit from behind all afternoon. It clears the
// suggestion to the type that explains it and asks once.
export const FEWER_POINTS_LINE = 'Won with fewer points: check the win type.'

// G31. A forty match event put forty rows under the one control this screen exists for.
// The Live queue is capped the same way and states its own remainder.
export const PENDING_CAP = 8
const WIN_TYPE_KEY: Record<string, WinType> = { p: 'points', s: 'submission', d: 'decision' }

// One set of tracks for the head and every row: name, points, the win type as a
// word, points, name, time, one action. Every numeric track is a Ledger Grid token
// (2.7) so a score sits in the same register here as on Roster, Matches and Live.
// Declared on a mono element or ch measures the sans zero and the head stops lining
// up with its own digits.
// The win type track is 6.6's 84px, not the 88px the points well happens to be: the two
// numbers are unrelated and the row was reading a form field's height as a column width.
const LEDGER_COLS =
  'grid grid-cols-[minmax(0,1fr)_var(--col-num-s)_84px_var(--col-num-s)_minmax(0,1fr)_var(--col-num-l)_var(--col-act)_var(--col-act)] items-center gap-x-3 px-3 font-mono t2'

interface NewEntryBody { entryId: string; athleteAId: number; athleteBId: number; pointsA: number; pointsB: number; winnerAthleteId: number; winType: WinType }
interface CorrectionBody { entryId: string; pointsA: number; pointsB: number; winnerAthleteId: number; winType: WinType }
interface EntryResponse { match?: EntryMatch | null; version?: number }
// The POST answers 201 for a write it made and 200 for one it deduped.
interface EntryResult { res: EntryResponse; duplicate: boolean }
// The result this attempt asked the server to store, to compare against the one it returns.
interface Sent { winnerAthleteId: number; winType: WinType; scores: Record<number, number> }

/**
 * One press of Save, frozen whole.
 *
 * 7.12's automatic retry re-sends the write the desk actually pressed Save on, so every
 * part of it -- the body, the held entryId, the pair the guard logs, the sentence the
 * fallback announces -- is captured at the press rather than read off a form the desk may
 * have moved on from.
 */
interface Attempt {
  payload: Form
  key: string
  typed: string
  sent: Sent
  request: { kind: 'create'; body: NewEntryBody } | { kind: 'correct'; id: number; body: CorrectionBody }
}

export function EntryTab({ detail }: { detail: EventDetail }) {
  const eventId = detail.event.id
  const [teamA, teamB] = detail.teams
  // One fact, one source: the stream the event body already polls, with the stored value
  // as the fallback until the first snapshot lands. The newest snapshot rather than a
  // frozen one, because this is a statement about the room and not about a picture.
  const stream = useSnapshot(eventId).live
  const mode = modeOf(stream, detail.event.mode)
  // The status the same way: Finish pressed on a second device reaches this form through
  // the stream, and a form left up over a finished event is a form that still says Save.
  const eventStatus = statusOf(stream, detail.event.status)
  // One read of storage for the three things a restored draft decides: the form, the
  // banner over it, and the payload the id it carries is already bound to.
  const [restored] = useState(() => {
    const draft = restoreDraft(eventId)
    return {
      form: draft ? { ...draft, touched: draft.winner !== null } : fresh(),
      banner: draft ? restoredBannerCopy(draft, detail.matches, detail.athletes) : null,
      shape: draft ? entryShape(draft) : null,
    }
  })
  const [f, setF] = useState<Form>(restored.form)
  const [failure, setFailure] = useState<SaveErrorCopy | null>(restored.banner)
  const [dupe, setDupe] = useState<SaveErrorCopy | null>(null)
  const [finishOpen, setFinishOpen] = useState(false)
  const [pairPrompt, setPairPrompt] = useState<string | null>(null)
  const [savedLabel, setSavedLabel] = useState(false)
  const [announce, setAnnounce] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  const [savedAt, setSavedAt] = useState<Record<number, number>>({})
  const [cue, setCue] = useState<{ id: number; on: boolean } | null>(null)
  const [history, setHistory] = useState<HistorySource | null>(null)
  // 6.9 takes the form away once the event is finished, and ruling A keeps corrections
  // open until certification, so the ledger's Edit hands a settled result to the one
  // correction dialog rather than to a form that is no longer on the screen.
  const [correcting, setCorrecting] = useState<MatchRow | null>(null)
  // Whether the desk has answered G30's prompt by naming a win type since the pick.
  const [winTypeChecked, setWinTypeChecked] = useState(false)
  // Seeded from the ledger so a reload does not reopen the same-pair window on a result
  // the server already holds.
  const [seededPairs] = useState(() => seedPairLog(detail.matches))
  const pairLog = useRef<Record<string, number>>(seededPairs)
  // What the current entryId has already been sent with, and whether the server said in so
  // many words that it stored nothing. Both have to hold before a corrected retry may carry
  // a new id: a restored draft carries no verdict, so it keeps the id it was stored with.
  const lastAttempt = useRef<{ shape: string; refused: boolean } | null>(
    restored.shape === null ? null : { shape: restored.shape, refused: false },
  )
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  /**
   * 7.12's automatic retry, and the press it is retrying.
   *
   * The arm is a rising number rather than a flag, and that is load bearing. A retry
   * stops the clock and its answer starts it again, and React batches those two updates
   * into one render whenever the answer lands in the same task: a boolean would go false
   * and back to true, the effect would see no change, and the loop would stop after
   * exactly one retry. A number that only ever rises always reads as a change.
   */
  const [retryArm, setRetryArm] = useState<number | null>(null)
  const arms = useRef(0)
  const attempt = useRef<Attempt | null>(null)
  const sendRef = useRef<(a: Attempt) => void>(() => {})
  const stopRetry = () => setRetryArm(null)
  const armRetry = () => { arms.current += 1; setRetryArm(arms.current) }

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

  // 7.12's deadline and 6.6's confirmation both belong to the POST. The refetch that
  // repaints the ledger runs behind them, so a slow one can no longer spend the desk's
  // eight seconds and report a saved result as a failure.
  const create = useAdminMutation(eventId, async (body: NewEntryBody): Promise<EntryResult> => {
    let status = 0
    const res = await adminApi<EntryResponse>(`/api/events/${eventId}/entries`, { method: 'POST', body, onStatus: s => { status = s } })
    return { res, duplicate: status === 200 }
  }, { awaitRefetch: false })
  // A correction answers 200 either way, so a replay is read off the result it returns
  // rather than off the status.
  const correct = useAdminMutation(eventId, async (v: { id: number; body: CorrectionBody }): Promise<EntryResult> =>
    ({ res: await adminApi<EntryResponse>(`/api/matches/${v.id}/entry`, { method: 'POST', body: v.body }), duplicate: false }), { awaitRefetch: false })
  const start = useAdminMutation<void>(eventId, () => adminApi(`/api/events/${eventId}`, { method: 'PATCH', body: { status: 'live' } }))
  const finish = useAdminMutation<void>(eventId, () => adminApi(`/api/events/${eventId}`, { method: 'PATCH', body: { status: 'done' } }))

  // Every terminal outcome re-enables Save, the watchdog included, because a POST
  // that never answers must not leave a reload as the only way out.
  const inFlight = (create.isPending || correct.isPending) && !timedOut
  const canSave = !!a && !!b && winner !== null
  // Derived, not remembered, so fixing the points takes the line away without a second
  // press. It stands until the desk names a win type, which is the answer it asks for.
  const wonWithFewerPoints = !!a && !!b && winner !== null && !winTypeChecked
    && (winner === 'a' ? pA < pB : pB < pA)
  const wins = useMemo(() => teamWins(detail.matches, detail.athletes), [detail.matches, detail.athletes])
  const winsA = wins.get(teamA.id) ?? 0
  const winsB = wins.get(teamB.id) ?? 0

  // A points edit alone never resets touched: auto-derivation from points only
  // drives the suggestion until the organizer picks a winner or a win type (or
  // loads a match to correct); after that the pick sticks until Save or Cancel edit.
  //
  // Every edit also stops 7.12's automatic retry. The retry re-sends the press it was
  // armed on, and once the desk has changed the form that press is no longer the result
  // they mean: the next Save is the one that says so.
  const edit = (update: (s: Form) => Form) => { stopRetry(); setF(update) }
  const setPoints = (key: 'pointsA' | 'pointsB') => (v: string) => edit(s => ({ ...s, [key]: v.replace(/\D/g, '').slice(0, 2) }))
  const pickKid = (key: 'aId' | 'bId') => (v: string) => {
    setPairPrompt(null)
    edit(s => ({ ...s, [key]: v }))
  }
  // A winner with fewer points cannot have won on points, so the pick takes the win type
  // with it rather than leaving the derived "Points" standing over a result it contradicts.
  const trails = (w: 'a' | 'b') => (w === 'a' ? pA < pB : pB < pA)
  const pickWinner = (w: 'a' | 'b') => {
    setWinTypeChecked(false)
    edit(s => {
      const derived = defaultOutcome(pA, pB)
      const nextWinType = trails(w) ? 'submission'
        : s.touched ? s.winType
        : derived.winner === null ? 'decision' : derived.winType
      return { ...s, winner: w, winType: nextWinType, touched: true }
    })
  }
  const pickType = (t: WinType) => {
    setWinTypeChecked(true)
    edit(s => ({ ...s, winner, winType: t, touched: true }))
  }

  // The save's own focus, announced to 4.4's gate so the refetch it triggered is not
  // held behind it. The grant ends the moment the operator touches the field.
  const focusFirstField = () => focusWithoutEngaging(formRef.current?.querySelector<HTMLElement>('#entry-a-competitor'))
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
    stopRetry()
    setWinTypeChecked(false)
    const kept = editingId === null ? null : loadDraft(eventId)
    if (!kept) {
      setF(fresh())
      setFailure(null)
      lastAttempt.current = null
      return
    }
    setF({ ...kept, touched: kept.winner !== null })
    setFailure(RESTORED_NEW_ENTRY)
    lastAttempt.current = { shape: entryShape(kept), refused: false }
  }

  const onSaved = (out: EntryResult | undefined, { key, typed, sent, payload }: Attempt) => {
    settle()
    stopRetry()
    attempt.current = null
    clearDraft(eventId, payload.editingId)
    pairLog.current[key] = Date.now()
    const outcome = storedOutcome(out?.res.match)
    // A replay carries the result the server already had, which is the one the desk needs
    // to read: it is not what was just typed, and only the ledger can change it now.
    const replayed = out?.duplicate === true || (outcome !== null && !outcomeMatches(outcome, sent))
    const id = out?.res.match?.id
    if (typeof id === 'number') {
      const at = Date.now()
      setSavedAt(s => ({ ...s, [id]: at }))
      setCue({ id, on: true })
    }
    setPairPrompt(null)
    setTimedOut(false)
    setSavedLabel(true)
    setDupe(replayed ? duplicateCopy(outcome) : null)
    setAnnounce(outcome === null ? typed : `${replayed ? 'Already saved.' : 'Saved.'} ${outcome.sentence}.`)
    later(() => setSavedLabel(false), SAVED_LABEL_MS)
    resume(payload.editingId)
    focusFirstField()
  }

  const onFailed = (a: Attempt, error: unknown) => {
    settle()
    saveDraft(eventId, draftOf(a.payload))
    lastAttempt.current = { shape: entryShape(draftOf(a.payload)), refused: serverRefused(error) }
    setFailure(saveErrorCopy(error))
    // Only the unreachable server and the watchdog re-arm the clock. Every refusal the
    // server answered stops it, because a retry would only ask for the same refusal.
    attempt.current = a
    if (retriesItself(error)) armRetry()
    else stopRetry()
  }

  /**
   * One dispatch for the first press and for every automatic retry.
   *
   * The clock is stopped here and restarted by the answer rather than run free, so a
   * retry can never overlap the attempt before it: the watchdog gives an attempt eight
   * seconds and the interval is five.
   */
  const send = (a: Attempt) => {
    setDupe(null)
    setTimedOut(false)
    stopRetry()
    settle()
    watchdog.current = setTimeout(() => {
      setTimedOut(true)
      onFailed(a, new Error('timeout'))
    }, SAVE_TIMEOUT_MS)
    const answered = {
      onSuccess: (out: EntryResult) => onSaved(out, a),
      onError: (err: Error) => onFailed(a, err),
    }
    if (a.request.kind === 'correct') correct.mutate({ id: a.request.id, body: a.request.body }, answered)
    else create.mutate(a.request.body, answered)
  }

  useEffect(() => { sendRef.current = send })
  useEffect(() => {
    if (retryArm === null) return
    const t = setTimeout(() => {
      const a = attempt.current
      if (a) sendRef.current(a)
    }, RETRY_INTERVAL_MS)
    return () => clearTimeout(t)
  }, [retryArm])

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
    // The fallback only. The confirmation is read off the response wherever the response
    // carries a result, because that is what is on file.
    const typed = `Saved. ${athleteName(won)} beat ${athleteName(lost)} ${winTypeLabel(winType)}, ${pA} to ${pB}.`
    const sent: Sent = { winnerAthleteId, winType, scores: { [a.id]: pA, [b.id]: pB } }

    // 7.12 holds one id through a retry so a resend is deduped. A retry whose payload the
    // operator has corrected is a different write, but only a failure the server refused
    // outright proves the first write is not on file: after a timeout or a dropped
    // connection a new id would insert a second done match and count the team's win twice,
    // so the id is kept and the resend comes back as the duplicate it is.
    const shape = entryShape(draftOf({ ...f, winner, winType }))
    const prior = lastAttempt.current
    const entryId = prior !== null && prior.refused && prior.shape !== shape ? newEventId() : f.entryId
    lastAttempt.current = { shape, refused: false }
    const payload: Form = { ...f, entryId, winner, winType, touched: true }
    if (entryId !== f.entryId) setF(s => ({ ...s, entryId }))

    send({
      payload, key, typed, sent,
      request: f.editingId !== null
        ? { kind: 'correct', id: f.editingId, body: { entryId, pointsA: pA, pointsB: pB, winnerAthleteId, winType } }
        : { kind: 'create', body: { entryId, athleteAId: a.id, athleteBId: b.id, pointsA: pA, pointsB: pB, winnerAthleteId, winType } },
    })
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
    stopRetry()
    // The win type on a stored result has already been decided, so a correction opens
    // without G30's prompt over a submission somebody recorded on purpose.
    setWinTypeChecked(true)
    setF({
      aId: String(m.athleteAId), bId: String(m.athleteBId),
      pointsA: String(m.pointsA), pointsB: String(m.pointsB),
      winner: m.winnerAthleteId === m.athleteAId ? 'a' : 'b', winType: m.winType ?? 'points',
      touched: true, editingId: m.id, entryId: newEventId(),
    })
    setFailure(null)
    setDupe(null)
    setPairPrompt(null)
    setAnnounce('')
    lastAttempt.current = null
    focusPoints()
  }
  // The other door out of a correction, and it strands the same way load did:
  // leaving a correction for a fresh entry must close the correction's slot, or a
  // failed save on it survives and later restores as an entry nobody typed.
  const use = (m: MatchRow) => {
    if (f.editingId !== null) clearDraft(eventId, f.editingId)
    stopRetry()
    setWinTypeChecked(false)
    setPairPrompt(null)
    setFailure(null)
    setDupe(null)
    setF({ ...fresh(), aId: String(m.athleteAId), bId: String(m.athleteBId) })
    lastAttempt.current = null
    focusPoints()
  }
  // Cancelling an edit drops that correction's own draft: a correction sets one
  // match's result rather than creating a win, so re-sending it under a new id
  // cannot double anything, and a kept draft would reappear on the next load as
  // an entry nobody meant to make. It never touches the new-entry slot.
  const cancelEdit = () => {
    clearDraft(eventId, f.editingId)
    setPairPrompt(null)
    setDupe(null)
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

  const done = useMemo(() => sortDoneMatches(detail.matches.filter(m => m.status === 'done')), [detail.matches])
  const shown = done.slice(0, LEDGER_LIMIT)
  // The Matches tab's own lines, so the position and the mat printed here are the ones
  // the desk will read when the remainder sends them there. Deriving them separately
  // gave two screens two numbering schemes for one running order.
  const pending = useMemo(() => matchLines(detail, stream).filter(l => l.status === 'pending'), [detail, stream])
  const shownPending = pending.slice(0, PENDING_CAP)
  const pendingRest = pending.length - shownPending.length
  const name = (id: number) => { const k = byId.get(id); return k ? athleteName(k) : 'Unknown' }
  const matNumberOf = (m: MatchRow) => detail.mats.find(mat => mat.id === m.matId)?.number ?? null
  // Read off the competitor rather than off the column, because the plate is a colour and
  // a wrong one is worse than none: nothing guarantees athlete A is on team A.
  const teamOfAthlete = (id: number) => detail.teams.find(t => t.id === byId.get(id)?.teamId) ?? teamA
  const startError = start.error
  // 6.9: a finished event stops taking results, so the form and every path back into it
  // go rather than sit there disabled. Nothing left on the screen says it can be scored.
  const finished = isFinished(eventStatus)
  const certified = eventStatus === 'certified'
  const closeFinish = () => { setFinishOpen(false); finish.reset() }
  const band = certified
    ? CERTIFIED_ENTRY_LINE
    : finished
      ? FINISHED_LINE
      : eventStatus === 'setup'
        ? 'The board shows this event as in progress once you start it.'
        : 'The board switches to the final result when you finish the event.'

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

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-1 px-4 py-3">
        <p className="t2 text-gray-11">{band}</p>
        {eventStatus === 'setup' && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => start.mutate()} disabled={start.isPending}>Start event</Button>
        )}
        {eventStatus === 'live' && (
          <Button size="sm" variant="destructive" className="ml-auto" onClick={() => setFinishOpen(true)} disabled={finish.isPending}>Finish event</Button>
        )}
      </div>
      {startError && (
        <Alert>
          <AlertTitle>The event did not start</AlertTitle>
          <AlertDescription>{startError.message}</AlertDescription>
        </Alert>
      )}

      <div className={cn('grid items-start gap-6', !finished && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
        {!finished && (
        <div className="grid gap-6">
          <form ref={formRef} onSubmit={submit} onKeyDown={onKeyDown} className="rounded-lg bg-gray-2 p-4">
            <div className="mb-1 flex items-baseline gap-3">
              <h3 className="t4">{f.editingId !== null ? 'Correct a result' : 'New result'}</h3>
              {f.editingId !== null && <span className="t2 text-attend">Editing a saved result</span>}
            </div>
            <div className="mb-4 grid gap-1">
              <p className="t2 text-gray-10">Type each result as it comes off the mat. Pick both competitors, enter points, press Save.</p>
              {mode === 'live' && <p className="t2 text-gray-11">{MAT_NOTE}</p>}
            </div>

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
            {/* Not amber: kids submit from behind all afternoon, and section 8 keeps
                --attend for a state nothing is currently doing anything about. */}
            {wonWithFewerPoints && <p className="mt-3 t2 text-gray-11">{FEWER_POINTS_LINE}</p>}

            {pairPrompt !== null && (
              <Alert variant="attend" className="mt-4">
                <AlertTitle variant="attend">These two were just entered</AlertTitle>
                <AlertDescription>{a && b ? `${athleteName(a)} and ${athleteName(b)} have a result from the last minute. Press Save again to record a second one.` : 'Press Save again to record a second result.'}</AlertDescription>
              </Alert>
            )}
            {dupe && (
              <Alert variant="attend" className="mt-4">
                <AlertTitle variant="attend">{dupe.title}</AlertTitle>
                <AlertDescription>{dupe.body}</AlertDescription>
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
                {shownPending.map(line => (
                  <ListRow key={line.row.id} className="flex items-center gap-3">
                    {/* The position the running order is read by, and the mat it sits on,
                        both in the figure face so a column of them lines up. */}
                    <span className="shrink-0 t2 text-gray-10">
                      <span className="sr-only">Match </span>
                      <span className="fig">{line.position}</span>
                    </span>
                    <span className="min-w-0 flex-1 truncate t3">{name(line.row.athleteAId)} vs {name(line.row.athleteBId)}</span>
                    <span className="shrink-0 t2 text-gray-10">
                      {line.matNumber === null ? 'No mat' : <>Mat <span className="fig">{line.matNumber}</span></>}
                    </span>
                    {line.row.why && <span className="t2 text-gray-10">{line.row.why}</span>}
                    <Button size="sm" variant="secondary" onClick={() => use(line.row)}>Use</Button>
                  </ListRow>
                ))}
              </List>
              {/* The remainder still states the depth, at a bounded height, and names the
                  screen that holds the rest rather than leaving the desk to find it. */}
              {pendingRest > 0 && (
                <p className="t2 text-gray-10">and <span className="fig">{pendingRest}</span> more on the Matches tab</p>
              )}
            </section>
          )}
        </div>
        )}

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
            <span className="sr-only">History</span>
            <span className="sr-only">Edit</span>
          </div>
          {shown.length === 0
            ? <EmptyState message={finished ? 'This event finished with no results.' : 'No results yet. Type the first one on the left.'} />
            : shown.map(m => (
              <LedgerRow
                key={m.id}
                match={m}
                nameA={name(m.athleteAId)}
                nameB={name(m.athleteBId)}
                teamOfA={teamOfAthlete(m.athleteAId)}
                teamOfB={teamOfAthlete(m.athleteBId)}
                at={ledgerTime(m.endedAt, savedAt[m.id])}
                cued={cue?.id === m.id && cue.on}
                cueing={cue?.id === m.id}
                onEdit={certified ? undefined : finished ? () => setCorrecting(m) : () => load(m)}
                onHistory={() => setHistory(matchHistorySource(matchViewOf(m, detail, stream), matNumberOf(m), detail))}
              />
            ))}
        </section>
      </div>

      <ResultDialog
        detail={detail}
        match={correcting === null ? null : matchViewOf(correcting, detail, stream)}
        open={correcting !== null}
        onOpenChange={o => { if (!o) setCorrecting(null) }}
      />
      <MatchHistorySheet source={history} open={history !== null} onOpenChange={o => { if (!o) setHistory(null) }} />

      <FinishEventDialog
        open={finishOpen}
        onOpenChange={o => { if (o) setFinishOpen(true); else closeFinish() }}
        detail={detail}
        snapshot={stream}
        pending={finish.isPending}
        error={finish.error}
        onFinish={() => finish.mutate(undefined, { onSuccess: () => setFinishOpen(false) })}
      />
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
function LedgerRow({ match, nameA, nameB, teamOfA, teamOfB, at, cued, cueing, onEdit, onHistory }: {
  match: MatchRow
  nameA: string
  nameB: string
  /** 6.6: plate, name, score, mark, win type, score, name, plate. The head's two codes
      say which column is whose; the row's plates say which team each competitor is on,
      which is the fact a desk scanning two hundred rows is actually looking for. */
  teamOfA: TeamRow
  teamOfB: TeamRow
  at: Date | null
  cued: boolean
  cueing: boolean
  /** Absent once the event is certified: nothing after that may offer a way to change it. */
  onEdit?: () => void
  /** Read only, so it survives certification: the trail is what certification protects. */
  onHistory: () => void
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
      <span data-side="a" data-outcome={aWon ? 'win' : 'loss'} className={cn('flex min-w-0 items-center gap-2 font-sans t3', aWon ? 'font-medium text-white' : 'text-gray-10')}>
        <TeamPlate color={teamOfA.color} name={teamOfA.name} size="inline" showName={false} />
        {aWon && <Mark side="left" />}
        <span className="truncate">{nameA}</span>
      </span>
      <span className={cn('fig text-right', aWon ? 'text-white' : 'text-gray-10')}>{match.pointsA}</span>
      <span className="truncate text-center font-sans t2 text-gray-10">{match.winType ? WIN_TYPE_WORD[match.winType] : ''}</span>
      <span className={cn('fig text-right', aWon ? 'text-gray-10' : 'text-white')}>{match.pointsB}</span>
      <span data-side="b" data-outcome={aWon ? 'loss' : 'win'} className={cn('flex min-w-0 items-center justify-end gap-2 font-sans t3', aWon ? 'text-gray-10' : 'font-medium text-white')}>
        <span className="truncate">{nameB}</span>
        {!aWon && <Mark side="right" />}
        <TeamPlate color={teamOfB.color} name={teamOfB.name} size="inline" showName={false} />
      </span>
      <span className="text-right t1 text-gray-10">{at === null ? '' : clockLabel(at)}</span>
      {/*
        xs carries a 44px hit area as a 28px control plus an 8px pseudo-element
        inset, which is 4px taller than this 40px rung and would sit on top of the
        rows above and below. It is also too wide for these two adjacent 28px tracks:
        the gap between them is 12px, so an 8px reach from each side left the two hit
        areas overlapping by 4px and a press in that band landed on whichever of
        History and Edit the DOM order gave it. Both reaches are clamped: 6px above
        and below fills the 40px rung, and 4px each side makes a 36px wide target with
        4px still clear between them.
      */}
      <Button
        variant="ghost"
        size="xs"
        title="Match history"
        aria-label={`History of ${winnerName} over ${loserName}`}
        onClick={onHistory}
        className="before:-inset-x-1 before:-top-1.5 before:-bottom-1.5"
      >
        <History />
      </Button>
      {onEdit === undefined ? <span /> : (
        <Button
          variant="ghost"
          size="xs"
          title="Edit result"
          aria-label={`Edit ${winnerName} over ${loserName}`}
          onClick={onEdit}
          className="before:-inset-x-1 before:-top-1.5 before:-bottom-1.5"
        >
          <PencilLine />
        </Button>
      )}
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
