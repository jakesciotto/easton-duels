import { useCallback, useEffect, useRef, useState } from 'react'
import type { MatchView, RulesetView, Snapshot, WinType } from '@shared/types'
import { ApiError } from '@/lib/api'
import type { MatBinding } from '@/lib/auth'
import { endMatch, heartbeat, postMatchEvent, undoLast, type ScoreResponse } from '@/lib/scoring'

const HEARTBEAT_MS = 20_000

export type SheetReason = 'terminal' | 'end' | 'time'
export interface Sheet { reason: SheetReason; winner: number | null; winType: WinType | null }

function derive(match: MatchView, ruleset: RulesetView | null): { winner: number | null; winType: WinType | null } {
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
  const current = mat?.current ?? null
  const ruleset = current ? snapshot?.rulesets.find(r => r.id === current.rulesetId) ?? null : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const seqRef = useRef<{ matchId: number; seq: number } | null>(null)

  // The newest seq wins, whether it came from the stream or from a write response.
  if (current && (!seqRef.current || seqRef.current.matchId !== current.id || current.lastSeq > seqRef.current.seq)) {
    seqRef.current = { matchId: current.id, seq: current.lastSeq }
  }

  useEffect(() => {
    void heartbeat(binding.matId, binding.token).catch(() => {})
    const id = setInterval(() => { void heartbeat(binding.matId, binding.token).catch(() => {}) }, HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [binding.matId, binding.token])

  // A new match clears any leftover sheet or error from the one before it.
  useEffect(() => { setSheet(null); setError(null) }, [current?.id])

  const run = useCallback(async (fn: (matchId: number, seq: number) => Promise<ScoreResponse>): Promise<ScoreResponse | null> => {
    if (!current || !seqRef.current || busy || !connected) return null
    setBusy(true)
    setError(null)
    try {
      const r = await fn(current.id, seqRef.current.seq)
      seqRef.current = { matchId: r.match.id, seq: Math.max(seqRef.current.seq, r.match.lastSeq) }
      return r
    } catch (e) {
      if (e instanceof ApiError && e.code === 'sequence') {
        const seq = Number(e.details.currentSeq)
        if (Number.isFinite(seq)) seqRef.current = { matchId: current.id, seq }
        setError('Re-synced with the server. Tap again.')
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not reach the server')
      }
      return null
    } finally {
      setBusy(false)
    }
  }, [current, busy, connected])

  const tap = (athleteId: number, actionKey: string) => run((id, seq) => postMatchEvent(id, binding.token, { type: 'score', athleteId, actionKey, lastSeq: seq }))
  const clock = () => run((id, seq) => postMatchEvent(id, binding.token, { type: current?.clock.startedAt ? 'clock_pause' : 'clock_start', lastSeq: seq }))
  const undo = () => run((id, seq) => undoLast(id, binding.token, seq))
  const terminal = async (athleteId: number, actionKey: string) => {
    const r = await run((id, seq) => postMatchEvent(id, binding.token, { type: 'terminal', athleteId, actionKey, lastSeq: seq }))
    if (r) setSheet({ reason: 'terminal', ...derive(r.match, ruleset) })
  }
  const openEnd = (reason: 'end' | 'time' = 'end') => {
    if (!current) return
    setSheet({ reason, ...derive(current, ruleset) })
  }
  const pickWinner = (athleteId: number) => setSheet(s => s ? { ...s, winner: athleteId, winType: s.winType ?? 'decision' } : s)
  const confirm = async () => {
    if (!sheet || sheet.winner === null) return
    const tie = current ? derive(current, ruleset).winner === null : false
    const r = await run((id, seq) => endMatch(id, binding.token, { lastSeq: seq, ...(tie ? { winnerAthleteId: sheet.winner! } : {}) }))
    if (r) setSheet(null)
  }
  const cancel = async () => {
    if (sheet?.reason === 'terminal') await run((id, seq) => undoLast(id, binding.token, seq))
    setSheet(null)
  }

  return { mat, current, ruleset, busy, error, sheet, tap, terminal, clock, undo, openEnd, pickWinner, confirm, cancel }
}
