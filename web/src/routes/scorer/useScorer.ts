import { useCallback, useEffect, useRef, useState } from 'react'
import type { MatchView, RulesetView, Snapshot, WinType } from '@shared/types'
import { formatClock, remainingMs } from '@shared/clock'
import { ApiError } from '@/lib/api'
import type { MatBinding } from '@/lib/auth'
import { endMatch, heartbeat, postMatchEvent, undoLast, type ScoreResponse } from '@/lib/scoring'
import { playRegistered, playRejected } from '@/lib/sounds'
import {
  applyClockPause, applyClockStart, applyScore, applyUndo, errorCopy, withDeadline,
  WRITE_DEADLINE_MS, type LocalAction,
} from './actions'

const HEARTBEAT_MS = 20_000

export type SheetReason = 'terminal' | 'end' | 'time'
export interface Outcome { winner: number | null; winType: WinType | null }
export interface Sheet extends Outcome {
  reason: SheetReason
  /** What the match derived when the sheet was raised: the statement the operator answers. */
  shown: Outcome
}

interface PendingOp {
  id: number
  apply: (match: MatchView) => MatchView
  needed: (match: MatchView) => boolean
}

function derive(match: MatchView, ruleset: RulesetView | null): Outcome {
  if (match.pendingTerminal) {
    const t = ruleset?.terminals.find(x => x.key === match.pendingTerminal!.actionKey)
    return { winner: match.pendingTerminal.athleteId, winType: t?.winType ?? 'submission' }
  }
  if (match.a.score > match.b.score) return { winner: match.a.athleteId, winType: 'points' }
  if (match.b.score > match.a.score) return { winner: match.b.athleteId, winType: 'points' }
  return { winner: null, winType: null }
}

export function useScorer(binding: MatBinding, snapshot: Snapshot | null, connected: boolean) {
  const mat = snapshot?.mats.find(m => m.id === binding.matId) ?? null
  const polled = mat?.current ?? null
  const [busy, setBusy] = useState(false)
  const [sheetBusy, setSheetBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [written, setWritten] = useState<MatchView | null>(null)
  const [writeMark, setWriteMark] = useState<{ seq: number; version: number } | null>(null)
  const [pending, setPending] = useState<PendingOp[]>([])
  const [log, setLog] = useState<LocalAction[]>([])
  const seqRef = useRef<{ matchId: number; seq: number; version: number } | null>(null)
  const projected = useRef<{ matchId: number; seq: number } | null>(null)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const generation = useRef(0)
  const opSeq = useRef(0)
  const inFlight = useRef(0)
  const offset = useRef(0)

  useEffect(() => {
    if (snapshot?.now) offset.current = Date.parse(snapshot.now) - Date.now()
  }, [snapshot?.now])

  // The snapshot poll is up to a full interval behind this scorer's own writes, so a tap
  // right after another one would read the pre-write clock and scores: Start then Start
  // again, or an End sheet asking to break a tie that a takedown already broke. The write
  // response is authoritative for its own match until a poll whose version has caught up
  // arrives. Comparing seq instead of version would pin the scorer to its own stale write
  // forever once another device's undo lowers the match's seq below what was just written.
  const base = written && writeMark && polled && written.id === polled.id && snapshot !== null && snapshot.version <= writeMark.version ? written : polled
  // 4.1: the four optimistic writes fold on top of whatever the server has agreed to.
  const current = base ? pending.reduce((m, op) => (op.needed(m) ? op.apply(m) : m), base) : null
  const ruleset = current ? snapshot?.rulesets.find(r => r.id === current.rulesetId) ?? null : null

  // The newest seq wins, whether it came from the stream or from a write response, and it
  // is taken VERBATIM in both directions: another device's undo lowers the match's seq, and
  // a seqRef that only ever climbed made the next tap here a guaranteed 409. It is read off
  // `base` rather than off `current`, because a queued write has to carry the seq the SERVER
  // last agreed to, not the one the optimistic fold is showing. The version is what keeps a
  // stale poll and the seq a conflict corrected us to from undoing each other: only a
  // snapshot newer than whatever set the current seq may replace it.
  if (base && snapshot && (
    seqRef.current === null
    || seqRef.current.matchId !== base.id
    || (base === polled && snapshot.version > seqRef.current.version)
  )) {
    seqRef.current = { matchId: base.id, seq: base.lastSeq, version: snapshot.version }
  }

  // Where the optimistic fold has got to, advanced synchronously as each op is composed.
  // Two taps inside one React batch see the same `current`, so an op composed from that
  // value would claim a seq the op before it already claimed and then fold itself away.
  if (base && (pending.length === 0 || projected.current?.matchId !== base.id)) {
    projected.current = { matchId: base.id, seq: base.lastSeq }
  }

  // Entries above the authoritative seq were rolled back by an undo, here or elsewhere.
  const live = current ? log.filter(a => a.seq <= current.lastSeq) : []
  const lastAction = current && live.length > 0 && live[live.length - 1].seq === current.lastSeq ? live[live.length - 1] : null

  useEffect(() => {
    void heartbeat(binding.matId, binding.token).catch(() => {})
    const id = setInterval(() => { void heartbeat(binding.matId, binding.token).catch(() => {}) }, HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [binding.matId, binding.token])

  // A new match clears any leftover sheet, error, optimistic write or local ledger.
  useEffect(() => {
    setSheet(null)
    setError(null)
    setPending([])
    setLog([])
  }, [current?.id])

  // An agreed seq only falls when events were taken away: a refused write rolling back, an
  // undo here, an undo on another device. Anything the ledger still holds above it describes
  // an event the server does not have, and leaving it there lets that entry become
  // `lastAction` again the moment any other device's write reaches its number -- the tablet
  // would name, and offer to subtract, something that never happened. It is only read while
  // nothing is pending, because an optimistic entry legitimately sits above the agreed seq
  // until its own write answers.
  const agreed = pending.length === 0 ? base?.lastSeq : undefined
  useEffect(() => {
    if (agreed === undefined) return
    setLog(l => (l.some(a => a.seq > agreed) ? l.filter(a => a.seq <= agreed) : l))
  }, [agreed, base?.id])

  /**
   * Every scoring write goes through one serial chain, because the server consumes lastSeq
   * in order: two taps issued in the same second must not race for the same seq. The task
   * reads seqRef at execution time rather than at enqueue time, so each write carries what
   * the one before it returned.
   */
  const enqueue = useCallback((fn: (matchId: number, seq: number) => Promise<ScoreResponse>, opId: number | null): Promise<ScoreResponse | null> => {
    const mine = generation.current
    const matchId = seqRef.current?.matchId
    inFlight.current += 1
    setBusy(true)
    const task = async (): Promise<ScoreResponse | null> => {
      try {
        // A failure rolls back everything unconfirmed, so anything queued behind it was
        // composed against state that no longer exists.
        if (generation.current !== mine) return null
        const at = seqRef.current
        if (matchId === undefined || !at || at.matchId !== matchId) return null
        try {
          const r = await withDeadline(fn(matchId, at.seq), WRITE_DEADLINE_MS)
          // Taken verbatim, never max'd against what was sent: an undo returns a LOWER
          // seq, and keeping the higher one makes the next tap a guaranteed 409.
          seqRef.current = { matchId: r.match.id, seq: r.match.lastSeq, version: r.version }
          setWritten(r.match)
          setWriteMark({ seq: r.match.lastSeq, version: r.version })
          if (opId !== null) setPending(p => p.filter(o => o.id !== opId))
          return r
        } catch (e) {
          generation.current += 1
          setPending([])
          if (e instanceof ApiError && e.code === 'sequence') {
            const s = Number(e.details.currentSeq)
            // The version is kept, not raised: the poll that carries this correction has
            // not arrived yet, and the next one that does may replace it.
            if (Number.isFinite(s)) seqRef.current = { matchId, seq: s, version: at.version }
          }
          setError(errorCopy(e))
          playRejected()
          return null
        }
      } finally {
        inFlight.current -= 1
        if (inFlight.current === 0) setBusy(false)
      }
    }
    const next = chain.current.then(task, task)
    chain.current = next.catch(() => null)
    return next
  }, [])

  const push = (op: Omit<PendingOp, 'id'>): number => {
    const id = ++opSeq.current
    setPending(p => [...p, { id, ...op }])
    return id
  }

  const tap = (athleteId: number, actionKey: string) => {
    const m = current
    const action = ruleset?.actions.find(a => a.key === actionKey)
    if (!m || !action || !connected || !projected.current) return
    setError(null)
    const target = ++projected.current.seq
    const name = m.a.athleteId === athleteId ? m.a.name : m.b.name
    const at = formatClock(remainingMs(m.clock, Date.now() + offset.current))
    setLog(l => [...l, { kind: 'score', seq: target, athleteId, name, label: action.label, points: action.points, at }])
    const id = push({ apply: x => applyScore(x, athleteId, action.points), needed: x => x.lastSeq < target })
    playRegistered()
    void enqueue((matchId, seq) => postMatchEvent(matchId, binding.token, { type: 'score', athleteId, actionKey, lastSeq: seq }), id)
  }

  const clock = () => {
    const m = current
    if (!m || !connected || !projected.current) return
    setError(null)
    const target = ++projected.current.seq
    const nowMs = Date.now() + offset.current
    const running = m.clock.startedAt !== null
    // 6.16: the ledger records the clock as well as the points, so the controls that have
    // to name the newest event can say it was the clock rather than claim this tablet
    // recorded nothing, and refuse for the reason that is actually true.
    const at = formatClock(remainingMs(m.clock, nowMs))
    setLog(l => [...l, { kind: 'clock', seq: target, label: running ? 'Clock paused' : 'Clock started', at }])
    const id = running
      ? push({ apply: x => applyClockPause(x, nowMs), needed: x => x.clock.startedAt !== null })
      : push({ apply: x => applyClockStart(x, new Date(nowMs).toISOString()), needed: x => x.clock.startedAt === null })
    void enqueue((matchId, seq) => postMatchEvent(matchId, binding.token, { type: running ? 'clock_pause' : 'clock_start', lastSeq: seq }), id)
  }

  const undo = () => {
    const m = current
    const target = lastAction
    if (!m || !connected || !projected.current || projected.current.seq === 0) return
    // The server's undo removes the newest event and nothing else, so this fires only when
    // that event is a score this tablet recorded. Undoing anything else means undoing what
    // the tablet cannot name: a pause the server refuses to remove, or a start whose
    // removal stops a clock the operator was not asking to stop.
    if (!target || target.kind !== 'score' || target.seq !== m.lastSeq) return
    setError(null)
    const gone = projected.current.seq
    projected.current.seq = gone - 1
    const id = push({ apply: x => applyUndo(x, target), needed: x => x.lastSeq >= gone })
    void enqueue((matchId, seq) => undoLast(matchId, binding.token, seq), id)
  }

  // The per side affordance is the same write; what differs is that it will only fire when
  // the newest event is one this tablet recorded FOR THAT SIDE, so it can name what it removes.
  const minus = (athleteId: number) => {
    if (!lastAction || lastAction.kind !== 'score' || lastAction.athleteId !== athleteId) return
    undo()
  }

  const raise = (reason: SheetReason, shown: Outcome) => setSheet({ reason, shown, ...shown })

  const terminal = async (athleteId: number, actionKey: string) => {
    // No busy guard: the chain serialises this behind any tap still in flight, where a
    // guard would drop the press with nothing said.
    if (!current || !connected) return
    setError(null)
    const r = await enqueue((matchId, seq) => postMatchEvent(matchId, binding.token, { type: 'terminal', athleteId, actionKey, lastSeq: seq }), null)
    if (r) raise('terminal', derive(r.match, ruleset))
  }

  const openEnd = (reason: 'end' | 'time' = 'end') => {
    if (!current) return
    raise(reason, derive(current, ruleset))
  }

  const pickWinner = (athleteId: number) => setSheet(s => s ? { ...s, winner: athleteId, winType: s.winType ?? 'decision' } : s)

  const confirm = async () => {
    if (!sheet || sheet.winner === null || sheetBusy) return
    // 4.4 suspends the poll under an open dialog everywhere else; the scorer cannot, because
    // an expiry under this sheet still has to sound and paint. So the sheet checks that the
    // match still says what it said when it was raised. The server derives the winner from
    // its own events and IGNORES winnerAthleteId once a tie is broken, so a decision picked
    // against a score that has since moved would silently record the other competitor.
    const now = current ? derive(current, ruleset) : sheet.shown
    if (now.winner !== sheet.shown.winner || now.winType !== sheet.shown.winType) {
      raise(sheet.reason, now)
      setError('The score changed. Check the result, then record it.')
      playRejected()
      return
    }
    setSheetBusy(true)
    try {
      const tie = sheet.shown.winner === null
      const r = await enqueue((matchId, seq) => endMatch(matchId, binding.token, { lastSeq: seq, ...(tie ? { winnerAthleteId: sheet.winner! } : {}) }), null)
      if (r) setSheet(null)
    } finally {
      setSheetBusy(false)
    }
  }

  // Gated on the sheet's own write rather than on the queue: a tap still in flight, or one
  // hung on a dead socket, must never be what stops the operator dismissing a modal.
  const cancel = async () => {
    if (sheetBusy) return
    if (sheet?.reason === 'terminal') {
      // A failed undo leaves pendingTerminal set on the server, so the sheet has to stay up
      // (with the error surfaced there) rather than dropping back to a scoring screen that no
      // longer matches server state.
      setSheetBusy(true)
      try {
        const r = await enqueue((matchId, seq) => undoLast(matchId, binding.token, seq), null)
        if (!r) return
      } finally {
        setSheetBusy(false)
      }
    }
    setSheet(null)
  }

  return { mat, current, ruleset, busy, sheetBusy, error, sheet, lastAction, tap, terminal, clock, undo, minus, openEnd, pickWinner, confirm, cancel }
}
