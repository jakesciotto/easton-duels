import { useEffect, useState, type FormEvent } from 'react'
import type { MatchView, WinType } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { newEventId } from '@/lib/ids'
import { winTypeLabel } from '@/lib/format'
import type { EventDetail, TeamRow } from '@/lib/types'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogStack, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Toggle } from '@/components/ui/toggle'
import { TeamPlate } from '@/components/TeamPlate'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const WIN_TYPES: { value: WinType; word: string }[] = [
  { value: 'points', word: 'Points' },
  { value: 'submission', word: 'Submission' },
  { value: 'decision', word: 'Decision' },
]

function timeOfDay(iso: string | null): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const hour = at.getHours() % 12 || 12
  return `${hour}:${String(at.getMinutes()).padStart(2, '0')} ${at.getHours() < 12 ? 'am' : 'pm'}`
}

/**
 * 6.13. The head states what is being corrected as one sentence: match, mat, time,
 * score and win type. It is captured when the dialog opens and never re-rendered from
 * a later poll, so the correction is made against a stated fact rather than against a
 * record that can move under the operator mid-edit.
 */
export function originalSentence(match: MatchView, matNumber: number | null): string {
  const parts = [`Match ${match.orderIndex + 1}`]
  parts.push(matNumber === null ? 'no mat' : `mat ${matNumber}`)
  const at = timeOfDay(match.endedAt)
  if (at) parts.push(`ended ${at}`)
  parts.push(`${match.a.score} to ${match.b.score}`)
  if (match.result) {
    const winner = match.result.winnerAthleteId === match.a.athleteId ? match.a.name : match.b.name
    parts.push(`${winner} ${winTypeLabel(match.result.winType)}`)
  } else {
    parts.push('no result recorded')
  }
  return `${parts.join(', ')}.`
}

// The same well the Entry tab uses, so a correction is the same physical action as an
// entry: 88px, black fill, radius 0 inside a padded field, one t8 numeral in a 2ch slot.
function PointsField({ id, label, value, align, onChange }: {
  id: string
  label: string
  value: string
  align: 'left' | 'right'
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className={cn(align === 'right' && 'justify-end')}>{label}</Label>
      <div className="grid h-[88px] place-items-center border border-gray-7 bg-background focus-within:shadow-focus">
        <input
          id={id}
          value={value}
          onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
          inputMode="numeric"
          autoComplete="off"
          maxLength={2}
          className="fig fig-2 w-full bg-transparent text-center t8 text-gray-12 outline-none"
        />
      </div>
    </div>
  )
}

export function ResultDialog({ detail, match, open, onOpenChange }: { detail: EventDetail; match: MatchView | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const eventId = detail.event.id
  const [entryId, setEntryId] = useState(newEventId)
  const [stated, setStated] = useState('')
  const [pointsA, setPointsA] = useState('')
  const [pointsB, setPointsB] = useState('')
  const [winner, setWinner] = useState<number | null>(null)
  const [winType, setWinType] = useState<WinType>('points')
  const save = useAdminMutation(eventId, (v: { id: number; body: unknown }) =>
    adminApi(`/api/matches/${v.id}/entry`, { method: 'POST', body: v.body }))

  // Reopening (even for the same match) always starts from the current result, so a
  // cancelled edit never leaves a stale pick behind for next time. The deps stay at the
  // open flag and the match id: a fresh snapshot of the same match must not overwrite
  // the pick being made, and must not rewrite the sentence being corrected against.
  useEffect(() => {
    if (!open || !match) return
    setEntryId(newEventId())
    setStated(originalSentence(match, detail.mats.find(m => m.id === match.matId)?.number ?? null))
    setPointsA(String(match.a.score))
    setPointsB(String(match.b.score))
    setWinner(match.result?.winnerAthleteId ?? null)
    setWinType(match.result?.winType ?? 'points')
    save.reset()
  }, [open, match?.id])

  if (!match) return null

  const team = (teamId: number | null): TeamRow => detail.teams.find(t => t.id === teamId) ?? detail.teams[0]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (winner === null) return
    save.mutate({
      id: match.id,
      body: { entryId, pointsA: Number(pointsA || 0), pointsB: Number(pointsB || 0), winnerAthleteId: winner, winType },
    }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(576)}>
        <form onSubmit={submit} className={dialogStack}>
          <DialogHeader><DialogTitle>Edit result</DialogTitle></DialogHeader>
          <DialogBody className={cn(dialogBody, 'gap-4 sm:grid-cols-2')}>
            <p className="t2 text-gray-10 sm:col-span-2">{stated}</p>

            <PointsField id="res-a-points" label={`${team(match.a.teamId).name} points`} value={pointsA} align="left" onChange={setPointsA} />
            <PointsField id="res-b-points" label={`${team(match.b.teamId).name} points`} value={pointsB} align="right" onChange={setPointsB} />

            <Toggle pressed={winner === match.a.athleteId} onPressedChange={() => setWinner(match.a.athleteId)}>
              <TeamPlate color={team(match.a.teamId).color} name={match.a.name} size="inline" showName={false} />
              <span className="truncate">{match.a.name} wins</span>
            </Toggle>
            <Toggle pressed={winner === match.b.athleteId} onPressedChange={() => setWinner(match.b.athleteId)}>
              <TeamPlate color={team(match.b.teamId).color} name={match.b.name} size="inline" showName={false} />
              <span className="truncate">{match.b.name} wins</span>
            </Toggle>

            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
              {WIN_TYPES.map(t => (
                <Toggle key={t.value} pressed={winType === t.value} onPressedChange={() => setWinType(t.value)} aria-label={winTypeLabel(t.value)} className="w-full">
                  {t.word}
                </Toggle>
              ))}
            </div>

            {save.error && (
              <Alert className="sm:col-span-2">
                <AlertTitle>That correction was not saved</AlertTitle>
                <AlertDescription>{save.error.message}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter className={dialogFooter}>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={winner === null || save.isPending}>Save result</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
