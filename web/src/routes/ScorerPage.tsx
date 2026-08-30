import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { getMatBinding, type MatBinding } from '@/lib/auth'
import { useSnapshot } from '@/lib/useSnapshot'
import { useClock } from '@/lib/useClock'
import { beep, unlockAudio } from '@/lib/sounds'
import { Connecting } from '@/components/Connecting'
import { ScoreSide } from './scorer/ScoreSide'
import { CenterColumn } from './scorer/CenterColumn'
import { ConfirmSheet } from './scorer/ConfirmSheet'
import { useScorer } from './scorer/useScorer'

function Scorer({ binding }: { binding: MatBinding }) {
  const { snapshot, connected } = useSnapshot(binding.eventId)
  const s = useScorer(binding, snapshot, connected)
  const { remainingMs } = useClock(s.current?.clock ?? null, snapshot?.now ?? null)
  const [flash, setFlash] = useState(false)
  // Which match we last reacted to an expiry for, and whether the clock has run since then.
  // Gating on "ran since" (not just "already fired for this match id") means a genuine second
  // expiry on the same match can still surface, while merely re-rendering after Cancel -- with
  // the clock still frozen at zero -- can't retrigger it.
  const firedForId = useRef<number | null>(null)
  const ranSinceFire = useRef(false)

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  // Time up: beep and flash once per expiry, once the server confirms the clock paused
  // (m.clock.elapsedMs only reflects that after a fresh snapshot, so this waits for the real thing
  // rather than guessing off the locally ticking countdown). Only opens the sheet if none is
  // already open -- a referee mid-pick on an "End match" tie must not lose that pick when the
  // clock happens to hit zero at the same moment.
  useEffect(() => {
    const m = s.current
    if (m?.clock.startedAt) ranSinceFire.current = true
    if (!m || m.status !== 'live' || m.pendingTerminal || remainingMs > 0 || m.clock.elapsedMs < m.clock.lengthMs) return
    if (firedForId.current === m.id && !ranSinceFire.current) return
    firedForId.current = m.id
    ranSinceFire.current = false
    beep()
    setFlash(true)
    if (!s.sheet) s.openEnd('time')
  }, [remainingMs, s])

  // Kept in its own effect, keyed only on the flash flag, so a re-render elsewhere (another
  // mat's score, a heartbeat-triggered snapshot) can never clear this timer early.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(false), 1500)
    return () => clearTimeout(t)
  }, [flash])

  const disabled = !connected || s.busy || !s.current || s.current.status !== 'live'
  const teams = snapshot?.teams ?? []

  return (
    <main className="relative flex h-dvh select-none overflow-hidden bg-background">
      <Connecting connected={connected} />
      {!s.current || !s.mat ? (
        <div className="grid flex-1 place-items-center text-2xl text-muted-foreground">No match on this mat. Waiting for the organizer.</div>
      ) : (
        <>
          <ScoreSide
            side={s.current.a}
            team={teams.find(t => t.id === s.current!.a.teamId)}
            ruleset={s.ruleset}
            disabled={disabled}
            pendingKey={s.current.pendingTerminal?.actionKey ?? null}
            onTap={k => s.tap(s.current!.a.athleteId, k)}
            onTerminal={k => s.terminal(s.current!.a.athleteId, k)}
          />
          <CenterColumn mat={s.mat} match={s.current} serverNow={snapshot?.now ?? null} disabled={disabled} flash={flash} onClock={s.clock} onUndo={s.undo} onEnd={() => s.openEnd('end')} />
          <ScoreSide
            side={s.current.b}
            team={teams.find(t => t.id === s.current!.b.teamId)}
            ruleset={s.ruleset}
            disabled={disabled}
            pendingKey={s.current.pendingTerminal?.actionKey ?? null}
            onTap={k => s.tap(s.current!.b.athleteId, k)}
            onTerminal={k => s.terminal(s.current!.b.athleteId, k)}
          />
          <ConfirmSheet sheet={s.sheet} match={s.current} teams={teams} busy={s.busy} error={s.error} onPick={s.pickWinner} onConfirm={s.confirm} onCancel={s.cancel} />
        </>
      )}
      {s.error && !s.sheet && (
        <div role="alert" className="fixed inset-x-0 bottom-3 z-30 mx-auto w-fit max-w-[90%] rounded-lg border border-destructive/40 bg-card px-4 py-2 text-sm font-medium text-destructive shadow-dialog">
          {s.error}
        </div>
      )}
    </main>
  )
}

export default function ScorerPage() {
  const { matId } = useParams()
  const binding = getMatBinding()
  if (!binding || binding.matId !== Number(matId)) return <Navigate to="/mat" replace />
  return <Scorer binding={binding} />
}
