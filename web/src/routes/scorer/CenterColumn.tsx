import type { MatchView, MatView } from '@shared/types'
import { formatClock } from '@shared/clock'
import { Clock } from '@/components/Clock'
import { useClock } from '@/lib/useClock'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ADD_TIME_MS, signed, type LocalAction } from './actions'
import {
  CLOCK_ROW, COLUMN_GAP, COMMIT, HEAD_GAP, HEAD_LINE, MOAT, PAD, REASON, RULE, SECONDARY,
  STACK_GAP, columnBudget,
} from './budget'
import { CLOCK_RUNNING } from './refusals'
import { useViewportHeight } from './viewport'

export interface CenterRefusals {
  clock: string | null
  addTime: string | null
  undo: string | null
  minusA: string | null
  minusB: string | null
}

// A reason line is reserved whether or not there is a reason to print, so a control that
// becomes refusable never moves the commit stack under the operator's thumb. Every reason
// fits the one line (refusals.ts asserts it); the clip is what a future one runs into
// rather than painting over the control below.
function Reason({ text }: { text: string | null }) {
  return <p className="w-full overflow-hidden t2 text-gray-10" style={{ height: REASON }}>{text}</p>
}

function MinusButton({ name, athleteId, points, refusal, onMinus }: {
  name: string
  athleteId: number
  points: number | null
  refusal: string | null
  onMinus: (athleteId: number) => void
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={refusal !== null}
      onClick={() => onMinus(athleteId)}
      className="touch min-w-0 flex-col gap-0.5"
      style={{ height: SECONDARY }}
    >
      <span className="t2">Minus{points === null ? '' : ` ${Math.abs(points)}`}</span>
      <span className="max-w-full min-w-0 truncate t1 font-normal! text-gray-10">{name}</span>
    </Button>
  )
}

function LastAction({ action }: { action: LocalAction | null }) {
  if (!action) return <p className="t2 text-gray-10">No action recorded on this tablet yet.</p>
  if (action.kind === 'clock') {
    return <p className="t2 text-gray-10">{action.label} at <span className="fig">{action.at}</span></p>
  }
  if (action.kind === 'extend') {
    return (
      <p className="t2 text-gray-10">
        {action.label} <span className="fig">{formatClock(action.addMs)}</span> at <span className="fig">{action.at}</span>
      </p>
    )
  }
  return (
    <p className="t2 text-gray-10">
      {action.label} <span className="fig">{signed(action.points)}</span> {action.name} at <span className="fig">{action.at}</span>
    </p>
  )
}

export function CenterColumn({ mat, match, serverNow, lastSuccessAt, pollIntervalMs, expired, lastAction, refusals, error, contact, onClock, onAddTime, onUndo, onMinus, onEnd }: {
  mat: MatView
  match: MatchView
  serverNow: string | null
  lastSuccessAt: number | null
  pollIntervalMs: number
  expired: boolean
  lastAction: LocalAction | null
  refusals: CenterRefusals
  error: string | null
  /** 6.4's contact line, or null when the event carries no desk contact. */
  contact: string | null
  onClock: () => void
  onAddTime: () => void
  onUndo: () => void
  onMinus: (athleteId: number) => void
  onEnd: () => void
}) {
  const running = match.clock.startedAt !== null
  const onDeck = mat.onDeck[0]
  // 1024 x 768 is the iPad's SCREEN. The column gets that minus the browser's chrome, and
  // at the bottom of that range the declared boxes do not all fit (budget.ts). What the
  // height decides is only whether the secondary minus row rides in the commit stack or in
  // the reference region below it; the head, the alarm and the three commit controls are
  // fixed at every height. Read once per resize, so a match never reshapes mid-round.
  const viewport = useViewportHeight()
  const budget = columnBudget(viewport)
  // The same readout the Clock computes from the same inputs, so the head and the notice
  // the Clock prints can never disagree about whether a poll is late.
  const { stale } = useClock(match.clock, serverNow, lastSuccessAt, pollIntervalMs)
  // Undo and the two minus buttons are one correction, and they refuse together in every
  // case but one: when the newest action is a score this tablet recorded, Undo is available
  // and only the far side's minus refuses, with a reason that names a competitor rather than
  // the match and so belongs on that button rather than in a line under both of them.
  const correctionReason = refusals.undo
  // 6.16 reserves this line for a reason the operator needs NOW, and the two controls above
  // it are refused in mutually exclusive states, so it can serve both. The clock speaks
  // first, because a refused Start is the press the thumb is already making. The extension
  // speaks only while the clock is stopped, and never for the one reason that is simply
  // that it is running: printed for the whole of every round, that sentence is a permanent
  // notice under the control the operator presses every thirty seconds, and it crowds out
  // the reason that will matter when the clock stops.
  const clockRowReason = refusals.clock
    ?? (!running && refusals.addTime !== CLOCK_RUNNING ? refusals.addTime : null)
  const minusPoints = (refusal: string | null) =>
    refusal === null && lastAction?.kind === 'score' ? lastAction.points : null

  // The common error is the wrong side a minute ago, which one global undo cannot name.
  const minusRow = (
    <div className="grid grid-cols-2 gap-4">
      <MinusButton
        name={match.a.name}
        athleteId={match.a.athleteId}
        points={minusPoints(refusals.minusA)}
        refusal={refusals.minusA}
        onMinus={onMinus}
      />
      <MinusButton
        name={match.b.name}
        athleteId={match.b.athleteId}
        points={minusPoints(refusals.minusB)}
        refusal={refusals.minusB}
        onMinus={onMinus}
      />
    </div>
  )

  return (
    <div
      className="flex w-80 shrink-0 flex-col items-center overflow-hidden border-x border-gray-7 bg-background"
      style={{ padding: PAD, gap: COLUMN_GAP }}
    >
      <div className="flex w-full shrink-0 flex-col items-center" style={{ gap: HEAD_GAP }}>
        {/* One line in the head, never two. A second row here is a row taken straight out
            of the guarantee (budget.ts), and at the shortest layout viewport there are
            three pixels to give. 7.6's staleness notice takes the slot, printed by the
            Clock under the digits, and the mat identity stands down for it: between "which
            mat is this" and "these numbers are not moving", the row belongs to the one that
            changes. */}
        {!stale && (
          <div className="flex w-full items-center justify-center overflow-hidden" style={{ height: HEAD_LINE }}>
            <span className="max-w-full truncate fig t1 text-gray-10">
              MAT {mat.number} · MATCH {match.orderIndex + 1} · {formatClock(match.clock.lengthMs)}
            </span>
          </div>
        )}
        <Clock
          clock={match.clock}
          serverNow={serverNow}
          lastSuccessAt={lastSuccessAt}
          pollIntervalMs={pollIntervalMs}
          className="text-[length:max(12vh,96px)] leading-none tracking-[-0.018em]"
          staleLabelClassName="shrink-0"
        />
      </div>

      {/* 6.16: the alarm holds until the result is recorded. It is FIXED -- it and the End
          match control below it are the two things on this column that may never be the
          elements that scroll away, so it sits outside the scroller, against the clock it
          is about. */}
      {expired && (
        <Alert className="w-full shrink-0">
          <AlertTitle>Time expired. Record the result or add time.</AlertTitle>
        </Alert>
      )}

      {/* What gives. The alarm and the commit stack hold their positions all afternoon and
          the reference content spends whatever is left between them: on a 1024 x 768 iPad
          with browser chrome and the alarm up, that is a few pixels, and this is the region
          that scrolls rather than the alarm or the control that answers it. */}
      <div className="flex w-full min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mt-auto grid w-full" style={{ gap: COLUMN_GAP }}>
          {error && (
            <Alert>
              <AlertTitle>That did not go through</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!expired && !error && onDeck && (
            <p className="truncate text-center t2 text-gray-10">Next: {onDeck.a.name} vs {onDeck.b.name}</p>
          )}
          {/* 6.16: a persistent last action line that the scorer and the coach beside them can
              reconcile against the referee's signal without touching anything. It is reference,
              so when the alarm needs the room this is what yields it. */}
          <LastAction action={lastAction} />
          {/* 6.4's footer line. It is reference rather than a control, so it sits with the
              on deck and last action lines and yields to the alarm before either of them. */}
          {contact && <p className="text-center t2 text-gray-10">{contact}</p>}
          {!budget.minusRowFixed && minusRow}
        </div>
      </div>

      <div className="grid w-full shrink-0" style={{ gap: STACK_GAP }}>
        <Button
          type="button"
          variant="secondary"
          disabled={refusals.undo !== null}
          onClick={onUndo}
          className="touch w-full flex-col gap-1"
          style={{ height: COMMIT }}
        >
          <span>
            {lastAction?.kind === 'score' && `Undo ${lastAction.label.toLowerCase()} `}
            {lastAction?.kind === 'score' && <span className="fig">{signed(lastAction.points)}</span>}
            {lastAction?.kind === 'extend' && 'Undo the added time'}
            {(!lastAction || lastAction.kind === 'clock') && 'Undo the last action'}
          </span>
          {lastAction?.kind === 'score' && (
            <span className="max-w-full min-w-0 truncate t2 font-normal! text-gray-10">{lastAction.name}</span>
          )}
        </Button>

        {budget.minusRowFixed && minusRow}
        <Reason text={correctionReason} />

        {/* The clock's row holds both of its controls at one height rather than taking a
            row each: the guarantee at the shortest layout viewport has three pixels in it
            (budget.ts), and a second 104px row would put End match under the fold. They are
            never refused at the same time -- a running clock refuses the extension, an
            expired one refuses Start -- so the one reason line below serves both, and each
            sentence names the control it is about. What it will not carry is the running
            clock's own refusal: see clockRowReason. */}
        <div className="grid w-full" style={{ gridTemplateColumns: '3fr 2fr', gap: STACK_GAP * 2 }}>
          <Button
            type="button"
            variant={running ? 'secondary' : 'default'}
            disabled={refusals.clock !== null}
            onClick={onClock}
            className="touch w-full"
            style={{ height: CLOCK_ROW }}
          >
            {running ? 'Pause' : 'Start'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={refusals.addTime !== null}
            onClick={onAddTime}
            className="touch w-full"
            style={{ height: CLOCK_ROW }}
          >
            Add <span className="fig">{formatClock(ADD_TIME_MS)}</span>
          </Button>
        </div>
        <Reason text={clockRowReason} />

        {/* The moat again: the control that ends a match never shares a row, or a
            neighbourhood, with the one the operator presses every thirty seconds. */}
        <div aria-hidden style={{ height: MOAT }} />
        <div aria-hidden className="bg-gray-7" style={{ height: RULE }} />
        {/* Never refused: it opens the confirm sheet and writes nothing, so the sheet is
            where a connection problem gets said. */}
        <Button type="button" variant="secondary" onClick={onEnd} className="touch w-full" style={{ height: COMMIT }}>
          End match
        </Button>
      </div>
    </div>
  )
}
