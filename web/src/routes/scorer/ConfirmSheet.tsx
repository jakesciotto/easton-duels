import type { MatchSide, MatchView, TeamView, WinType } from '@shared/types'
import type { Sheet as SheetState } from './useScorer'
import { winTypeLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Toggle } from '@/components/ui/toggle'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TeamPlate } from '@/components/TeamPlate'

/** A winner, a win type and the score that produced them, all from the same instant. */
function Said({ side, winType, scores }: {
  side: MatchSide | null
  winType: WinType | null
  scores: { a: number; b: number }
}) {
  return (
    <>
      {side ? `${side.name} ${winTypeLabel(winType ?? 'decision')}` : 'a tie'},{' '}
      <span className="fig">{scores.a}</span> to <span className="fig">{scores.b}</span>
    </>
  )
}

export function ConfirmSheet({ sheet, match, teams, busy, error, onPick, onConfirm, onCancel }: {
  sheet: SheetState | null
  match: MatchView
  teams: TeamView[]
  /** This sheet's OWN write, never the queue: a tap hung on a dead socket must not be
   *  what stops the operator dismissing a modal that covers the whole screen. */
  busy: boolean
  error: string | null
  onPick: (athleteId: number) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const sideOf = (athleteId: number | null): MatchSide | null =>
    athleteId === null ? null : athleteId === match.a.athleteId ? match.a : match.b
  const winner = sheet ? sideOf(sheet.winner) : null
  // Set when the match moved out from under the open sheet. Everything about this branch
  // exists so that the press that answers it cannot be the one already under the finger.
  const changed = sheet?.changed ?? null
  const title = changed ? 'The score changed'
    : sheet?.reason === 'time' ? 'Time is up'
    : sheet?.reason === 'terminal' ? 'Match over'
    : 'End the match?'
  const teamOf = (teamId: number | null) => teams.find(t => t.id === teamId)

  const pickOne = () => (
    <div className="grid grid-cols-2 gap-4">
      {[match.a, match.b].map(side => (
        <Toggle
          key={side.athleteId}
          size="mat"
          pressed={sheet?.winner === side.athleteId}
          onPressedChange={() => onPick(side.athleteId)}
          aria-label={`${side.name} wins`}
          className="flex-col gap-1"
        >
          <TeamPlate color={teamOf(side.teamId)?.color ?? 'red'} name={teamOf(side.teamId)?.name ?? 'Unassigned'} size="desk" showName={false} />
          <span className="max-w-full min-w-0 truncate">{side.name} wins</span>
        </Toggle>
      ))}
    </div>
  )

  return (
    <Sheet open={sheet !== null} onOpenChange={o => { if (!o) onCancel() }}>
      {/* 4.4: this sheet reads the live match, so it is not held. confirm()
          refuses a commit whose result moved after the sheet was raised. */}
      <SheetContent side="bottom" data-poll-through>
        <SheetHeader showCloseButton={false}>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {changed ? (
            <>
              {/* State what changed, in the same shape as the restatement it replaces, so
                  the operator can read the two against each other in one glance. */}
              <Alert>
                <AlertTitle>The match moved while this was open</AlertTitle>
                <AlertDescription>
                  This was raised on{' '}
                  <Said side={sideOf(changed.was.winner)} winType={changed.was.winType} scores={changed.was.scores} />.
                  {' '}It now says{' '}
                  <Said side={sideOf(changed.now.winner)} winType={changed.now.winType} scores={changed.now.scores} />.
                </AlertDescription>
              </Alert>
              {/* The affirmative in the footer is disabled until one of these is pressed.
                  A control that names a competitor, in a different place from the button
                  the refusal happened under, is what makes this a new decision. */}
              {changed.now.winner === null ? pickOne() : (
                <Button
                  type="button"
                  variant="secondary"
                  className="touch h-[104px] w-full"
                  aria-label={`${sideOf(changed.now.winner)!.name} wins ${winTypeLabel(changed.now.winType ?? 'decision')}`}
                  onClick={() => onPick(changed.now.winner!)}
                >
                  <TeamPlate
                    color={teamOf(sideOf(changed.now.winner)?.teamId ?? null)?.color ?? 'red'}
                    name={teamOf(sideOf(changed.now.winner)?.teamId ?? null)?.name ?? 'Unassigned'}
                    size="desk"
                    showName={false}
                  />
                  <span className="max-w-full min-w-0 truncate">
                    {sideOf(changed.now.winner)!.name} wins {winTypeLabel(changed.now.winType ?? 'decision')}
                  </span>
                </Button>
              )}
            </>
          ) : winner && sheet?.winType ? (
            // 6.16: name, team, win type and the resulting score, in one line. The score is
            // the one the sheet was raised on, never the live one, so the line can never
            // print a score that contradicts the competitor it names.
            <p className="flex flex-wrap items-center gap-2 t5 text-gray-12">
              <TeamPlate color={teamOf(winner.teamId)?.color ?? 'red'} name={teamOf(winner.teamId)?.name ?? 'Unassigned'} size="desk" showName={false} />
              <span>{winner.name} wins {winTypeLabel(sheet.winType)},</span>
              <span className="fig">{sheet.shown.scores.a}</span>
              <span>to</span>
              <span className="fig">{sheet.shown.scores.b}</span>
            </p>
          ) : (
            <div className="grid gap-3">
              <p className="t3 text-gray-11">
                Scores are tied at <span className="fig">{sheet?.shown.scores.a ?? 0}</span>. Referee decision:
              </p>
              {pickOne()}
            </div>
          )}
          {!changed && error && (
            <Alert>
              <AlertTitle>That did not go through</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </SheetBody>
        {/* 6.16: the buttons say what they do, and there is no default affirmative. */}
        <SheetFooter className="gap-4">
          <Button type="button" variant="secondary" className="touch h-[104px] flex-1" onClick={onCancel} disabled={busy}>
            Back to match
          </Button>
          <Button
            type="button"
            className="touch h-[104px] flex-1"
            onClick={onConfirm}
            disabled={busy || !sheet || changed !== null || sheet.winner === null || sheet.winType === null}
          >
            Record win {winTypeLabel(sheet?.winType ?? 'decision')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
