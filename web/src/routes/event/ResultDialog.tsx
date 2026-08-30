import { useEffect, useState, type FormEvent } from 'react'
import type { MatchView, WinType } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Segment } from '@/components/ui/segment'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TeamDot } from '@/components/TeamDot'

const WIN_TYPES: { value: WinType; label: string }[] = [
  { value: 'points', label: 'On points' },
  { value: 'submission', label: 'By submission' },
  { value: 'decision', label: 'By decision' },
]

function WinnerButton({ name, color, pressed, onClick }: { name: string; color: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium text-soft shadow-[0_0_0_1px_#2f3037] transition-[color,background-color,box-shadow] duration-150 focus-visible:shadow-focus aria-pressed:bg-secondary aria-pressed:text-foreground aria-pressed:shadow-ring"
    >
      <TeamDot color={color} />
      <span>{name} wins</span>
    </button>
  )
}

export function ResultDialog({ detail, match, open, onOpenChange }: { detail: EventDetail; match: MatchView | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const eventId = detail.event.id
  const [winner, setWinner] = useState<number | null>(null)
  const [winType, setWinType] = useState<WinType>('points')
  const save = useAdminMutation(eventId, (v: { id: number; winnerAthleteId: number; winType: WinType }) =>
    adminApi(`/api/matches/${v.id}/result`, { method: 'POST', body: { winnerAthleteId: v.winnerAthleteId, winType: v.winType } }))

  // Reopening (even for the same match) always starts from the current result, so a cancelled
  // edit never leaves a stale pick behind for next time. The deps stay at the open flag and the
  // match id: a fresh snapshot of the same match must not overwrite the pick being made.
  useEffect(() => {
    if (!open || !match) return
    setWinner(match.result?.winnerAthleteId ?? null)
    setWinType(match.result?.winType ?? 'points')
    save.reset()
  }, [open, match?.id])

  if (!match) return null

  const teamColor = (teamId: number | null) => detail.teams.find(t => t.id === teamId)?.color ?? detail.teams[0].color

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (winner === null) return
    save.mutate({ id: match.id, winnerAthleteId: winner, winType }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid min-h-0">
          <DialogHeader><DialogTitle>Edit result</DialogTitle></DialogHeader>
          <DialogBody>
            <div className="grid grid-cols-2 gap-2">
              <WinnerButton name={match.a.name} color={teamColor(match.a.teamId)} pressed={winner === match.a.athleteId} onClick={() => setWinner(match.a.athleteId)} />
              <WinnerButton name={match.b.name} color={teamColor(match.b.teamId)} pressed={winner === match.b.athleteId} onClick={() => setWinner(match.b.athleteId)} />
            </div>
            <Segment value={winType} onValueChange={v => setWinType(v as WinType)} options={WIN_TYPES} aria-label="Win type" />
            {save.error && <p role="alert" className="text-[13px] text-destructive">{save.error.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={winner === null || save.isPending}>Save result</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
