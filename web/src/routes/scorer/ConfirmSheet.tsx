import type { MatchView, TeamView } from '@shared/types'
import type { Sheet as SheetState } from './useScorer'
import { winTypeLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Toggle } from '@/components/ui/toggle'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TeamPlate } from '@/components/TeamPlate'

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
  const winner = sheet && sheet.winner !== null ? (sheet.winner === match.a.athleteId ? match.a : match.b) : null
  const title = sheet?.reason === 'time' ? 'Time is up' : sheet?.reason === 'terminal' ? 'Match over' : 'End the match?'
  const teamOf = (teamId: number | null) => teams.find(t => t.id === teamId)

  return (
    <Sheet open={sheet !== null} onOpenChange={o => { if (!o) onCancel() }}>
      <SheetContent side="bottom">
        <SheetHeader showCloseButton={false}>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {winner && sheet?.winType ? (
            // 6.16: name, team, win type and the resulting score, in one line.
            <p className="flex flex-wrap items-center gap-2 t5 text-gray-12">
              <TeamPlate color={teamOf(winner.teamId)?.color ?? 'red'} name={teamOf(winner.teamId)?.name ?? 'Unassigned'} size="desk" showName={false} />
              <span>{winner.name} wins {winTypeLabel(sheet.winType)},</span>
              <span className="fig">{match.a.score}</span>
              <span>to</span>
              <span className="fig">{match.b.score}</span>
            </p>
          ) : (
            <div className="grid gap-3">
              <p className="t3 text-gray-11">
                Scores are tied at <span className="fig">{match.a.score}</span>. Referee decision:
              </p>
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
            </div>
          )}
          {error && (
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
            disabled={busy || !sheet || sheet.winner === null || sheet.winType === null}
          >
            Record win {winTypeLabel(sheet?.winType ?? 'decision')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
