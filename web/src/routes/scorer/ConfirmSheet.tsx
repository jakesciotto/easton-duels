import type { MatchView, TeamView } from '@shared/types'
import type { Sheet as SheetState } from './useScorer'
import { winTypeLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TeamDot } from '@/components/TeamDot'

function WinnerToggle({ name, color, pressed, onClick }: { name: string; color: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="touch inline-flex h-14 items-center justify-center gap-2 rounded-md text-base font-medium text-soft shadow-[0_0_0_1px_var(--input)] transition-[color,background-color,box-shadow] duration-150 focus-visible:shadow-focus aria-pressed:bg-secondary aria-pressed:text-foreground aria-pressed:shadow-ring"
    >
      <TeamDot color={color} />
      <span>{name} wins</span>
    </button>
  )
}

export function ConfirmSheet({ sheet, match, teams, busy, error, onPick, onConfirm, onCancel }: {
  sheet: SheetState | null; match: MatchView; teams: TeamView[]; busy: boolean; error: string | null
  onPick: (athleteId: number) => void; onConfirm: () => void; onCancel: () => void
}) {
  const winner = sheet && sheet.winner !== null ? (sheet.winner === match.a.athleteId ? match.a : match.b) : null
  const title = sheet?.reason === 'time' ? 'Time is up' : sheet?.reason === 'terminal' ? 'Match over' : 'End the match?'
  const colorOf = (teamId: number | null) => teams.find(t => t.id === teamId)?.color ?? 'red'

  return (
    <Sheet open={sheet !== null} onOpenChange={o => { if (!o) onCancel() }}>
      <SheetContent side="bottom">
        <SheetHeader showCloseButton={false}>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {winner && sheet?.winType ? (
            <p className="text-lg text-foreground">
              {winner.name} wins {winTypeLabel(sheet.winType)}, <span className="font-mono tabular">{match.a.score}</span> to <span className="font-mono tabular">{match.b.score}</span>
            </p>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm text-soft">Scores are tied at <span className="font-mono tabular">{match.a.score}</span>. Referee decision:</p>
              <div className="grid grid-cols-2 gap-3">
                <WinnerToggle name={match.a.name} color={colorOf(match.a.teamId)} pressed={sheet?.winner === match.a.athleteId} onClick={() => onPick(match.a.athleteId)} />
                <WinnerToggle name={match.b.name} color={colorOf(match.b.teamId)} pressed={sheet?.winner === match.b.athleteId} onClick={() => onPick(match.b.athleteId)} />
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </SheetBody>
        <SheetFooter className="gap-3">
          <Button type="button" size="lg" variant="secondary" className="touch h-14 flex-1" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="button" size="lg" className="touch h-14 flex-1" onClick={onConfirm} disabled={busy || !sheet || sheet.winner === null}>Confirm</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
