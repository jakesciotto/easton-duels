import { useEffect, useRef } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { getMatBinding, type MatBinding } from '@/lib/auth'
import { useSnapshot } from '@/lib/useSnapshot'
import { useClock } from '@/lib/useClock'
import { useWakeLock } from '@/lib/useWakeLock'
import { pollIntervalForSnapshot } from '@/lib/pollInterval'
import { playExpired, unlockAudio } from '@/lib/sounds'
import { buttonVariants } from '@/components/ui/button'
import { Connecting } from '@/components/Connecting'
import { ScoreSide } from './scorer/ScoreSide'
import { CenterColumn } from './scorer/CenterColumn'
import { ConfirmSheet } from './scorer/ConfirmSheet'
import { useScorer } from './scorer/useScorer'
import { clockRefusal, minusRefusal, scoreRefusal, undoRefusal } from './scorer/refusals'
import { useFitsScorer } from './scorer/viewport'

// 6.16: below 900 CSS px, or out of landscape, the honest answer is a plain page. A phone
// cannot hold a 20mm target in a three up grid, and this route is where a QR scan lands.
function WrongDevice({ binding }: { binding: MatBinding }) {
  const path = `/board/${binding.eventId}`
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="grid max-w-md gap-4">
        <h1 className="t5 text-gray-12">Use a tablet for scoring</h1>
        <p className="t3 text-gray-11">
          Scoring runs on an iPad held sideways. The buttons have to stay big enough to hit without
          looking, and a phone cannot hold them at that size.
        </p>
        <p className="t3 text-gray-11">To follow the scores from here, open the board instead.</p>
        <Link to={path} className={buttonVariants({ size: 'lg' })}>Open the board</Link>
        <p className="fig t2 break-all text-gray-10">{origin}{path}</p>
      </div>
    </main>
  )
}

function Scorer({ binding }: { binding: MatBinding }) {
  const { snapshot, connected, lastSuccessAt } = useSnapshot(binding.eventId)
  const s = useScorer(binding, snapshot, connected)
  const { remainingMs } = useClock(s.current?.clock ?? null, snapshot?.now ?? null)
  // Which match we last sounded an expiry for, and whether the clock has run since then.
  // Gating on "ran since" (not just "already fired for this match id") means a genuine second
  // expiry on the same match can still surface, while merely re-rendering with the clock
  // still frozen at zero can't retrigger it.
  const firedForId = useRef<number | null>(null)
  const ranSinceFire = useRef(false)

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  // STILL OPEN 8: this is the screen that must never sleep while a mat is being
  // scored, and it held no lock of its own -- the one MatPickPage acquired is
  // released the instant that route unmounts on the navigate() into this one.
  // Ask on mount, which is all Chromium needs (recent activation from the bind
  // form usually still covers it), and again on the mat's own first tap or key
  // press, which is all Safari needs since it refuses the request outside a
  // gesture. The hook's own in-flight guard (R6) makes it safe for this effect
  // to ask again even if a request from the handoff is already in flight.
  const wakeLock = useWakeLock()
  useEffect(() => {
    if (wakeLock.active) return
    const ask = () => void wakeLock.request()
    ask()
    window.addEventListener('pointerdown', ask)
    window.addEventListener('keydown', ask)
    return () => {
      window.removeEventListener('pointerdown', ask)
      window.removeEventListener('keydown', ask)
    }
  }, [wakeLock.active, wakeLock.request])

  const m = s.current
  // Server confirmed, not merely counted down: m.clock.elapsedMs only reaches the length
  // once a snapshot carries the pause the server wrote, so this waits for the real thing
  // rather than guessing off the locally ticking countdown.
  const expired = m !== null && m.status === 'live' && !m.pendingTerminal
    && remainingMs <= 0 && m.clock.elapsedMs >= m.clock.lengthMs

  // 6.16: the alarm is the frame and the Alert, both of which hold until the result is
  // recorded. The tone is a near field cue for whoever is holding the tablet, and it plays
  // exactly once per expiry -- no flash, no toast, no repeat.
  useEffect(() => {
    if (m?.clock.startedAt) ranSinceFire.current = true
    if (!expired || !m) return
    if (firedForId.current === m.id && !ranSinceFire.current) return
    firedForId.current = m.id
    ranSinceFire.current = false
    playExpired()
  }, [expired, m])

  const teams = snapshot?.teams ?? []
  const halfRefusal = scoreRefusal(connected, m)
  const refusals = {
    clock: clockRefusal(connected, m, expired),
    undo: undoRefusal(connected, m, s.lastAction, expired),
    minusA: m ? minusRefusal(connected, m, s.lastAction, m.a.athleteId) : null,
    minusB: m ? minusRefusal(connected, m, s.lastAction, m.b.athleteId) : null,
  }

  return (
    <main className="relative flex h-dvh select-none flex-col overflow-hidden bg-background">
      <Connecting connected={connected} />
      {/* A refused lock is the failure that ends the afternoon quietly, so it is
          said in words. It sits above the score sides rather than over them,
          because nothing may cover a control the scorer taps without looking. */}
      {wakeLock.failed && !wakeLock.active && (
        <div role="status" className="shrink-0 bg-gray-1 px-4 py-1.5 text-center t2 text-attend">
          Screen may sleep. Keep this tablet awake in its settings.
        </div>
      )}
      {!m || !s.mat ? (
        <div className="grid flex-1 place-items-center t5 text-gray-10">No match on this mat. Waiting for the organizer.</div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px_minmax(0,1fr)]">
          <ScoreSide
            side={m.a}
            team={teams.find(t => t.id === m.a.teamId)}
            ruleset={s.ruleset}
            edge="left"
            lead={m.a.score >= m.b.score}
            expired={expired}
            refusal={halfRefusal}
            onTap={k => s.tap(m.a.athleteId, k)}
            onTerminal={k => void s.terminal(m.a.athleteId, k)}
          />
          <CenterColumn
            mat={s.mat}
            match={m}
            serverNow={snapshot?.now ?? null}
            lastSuccessAt={lastSuccessAt}
            pollIntervalMs={pollIntervalForSnapshot(snapshot)}
            expired={expired}
            lastAction={s.lastAction}
            refusals={refusals}
            error={s.sheet ? null : s.error}
            onClock={s.clock}
            onUndo={s.undo}
            onMinus={s.minus}
            onEnd={() => s.openEnd(expired ? 'time' : 'end')}
          />
          <ScoreSide
            side={m.b}
            team={teams.find(t => t.id === m.b.teamId)}
            ruleset={s.ruleset}
            edge="right"
            lead={m.b.score >= m.a.score}
            expired={expired}
            refusal={halfRefusal}
            onTap={k => s.tap(m.b.athleteId, k)}
            onTerminal={k => void s.terminal(m.b.athleteId, k)}
          />
          <ConfirmSheet sheet={s.sheet} match={m} teams={teams} busy={s.sheetBusy} error={s.error} onPick={s.pickWinner} onConfirm={() => void s.confirm()} onCancel={() => void s.cancel()} />
        </div>
      )}
    </main>
  )
}

export default function ScorerPage() {
  const { matId } = useParams()
  const binding = getMatBinding()
  const fits = useFitsScorer()
  if (!binding || binding.matId !== Number(matId)) return <Navigate to="/mat" replace />
  if (!fits) return <WrongDevice binding={binding} />
  return <Scorer binding={binding} />
}
