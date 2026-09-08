import type { Snapshot } from '@shared/types'
import type { EventDetail, MatchRow } from '@/lib/types'
import { athleteName } from '@/lib/format'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { List, ListRow } from '@/components/ui/list'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'

export interface FinishEventDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: EventDetail
  /** The stream the tab already polls. The detail is the fallback until it lands. */
  snapshot?: Snapshot | null
  /** The status write is in flight. */
  pending: boolean
  error: Error | null
  onFinish: () => void
}

interface RunningMat { number: number; pair: string }

/**
 * The mats that would be cut off, named. `mats.currentMatchId` is the binding and the
 * match's own status is whether anything is on it, so a mat holding a match that has
 * already ended is not listed.
 */
export function runningMats(detail: EventDetail, snapshot: Snapshot | null = null): RunningMat[] {
  // The room's own account, when there is one: the detail cache is not invalidated by a
  // tablet ending a match, so at the most consequential press of the day it can list a
  // mat that finished minutes ago or omit one that just started.
  if (snapshot !== null) {
    return snapshot.mats
      .flatMap(m => (m.current !== null && m.current.status !== 'done'
        ? [{ number: m.number, pair: `${m.current.a.name} vs ${m.current.b.name}` }]
        : []))
      .sort((x, y) => x.number - y.number)
  }
  const byId = new Map(detail.athletes.map(a => [a.id, a]))
  const name = (id: number) => { const k = byId.get(id); return k ? athleteName(k) : 'Unknown' }
  const matchOf = (id: number | null): MatchRow | undefined =>
    id === null ? undefined : detail.matches.find(m => m.id === id)
  return detail.mats
    .map(mat => ({ mat, match: matchOf(mat.currentMatchId) }))
    .filter((row): row is { mat: typeof row.mat; match: MatchRow } => row.match !== undefined && row.match.status !== 'done')
    .map(({ mat, match }) => ({ number: mat.number, pair: `${name(match.athleteAId)} vs ${match.athleteBId ? name(match.athleteBId) : 'Unknown'}` }))
    .sort((x, y) => x.number - y.number)
}

/**
 * One Finish dialog for the whole event, so the Entry tab and the Live tab ask the same
 * question in the same words.
 *
 * It names the mats that are still on a match, because the sentence it replaces said the
 * opposite of what happens: a finished event refuses every write, so a match left running
 * is not a match that stays where it is, it is a result nobody can record.
 */
export function FinishEventDialog({ open, onOpenChange, detail, snapshot = null, pending, error, onFinish }: FinishEventDialogProps) {
  const running = runningMats(detail, snapshot)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(512)}>
        <DialogHeader><DialogTitle>Finish the event?</DialogTitle></DialogHeader>
        <DialogBody className={dialogBody}>
          <div className="grid gap-3">
            <p className="t3 text-gray-11">The board switches to the final result, and the server stops taking results.</p>
            {running.length > 0 && (
              <>
                <p className="t3 text-gray-11">
                  <span className="fig">{running.length}</span> {running.length === 1 ? 'mat is' : 'mats are'} still on a match.
                  Nothing can be scored on {running.length === 1 ? 'it' : 'them'} once the event is finished.
                </p>
                <List>
                  {running.map(mat => (
                    <ListRow key={mat.number} className="flex items-center gap-3">
                      <span className="shrink-0 t2 text-gray-10">Mat <span className="fig">{mat.number}</span></span>
                      <span className="min-w-0 flex-1 truncate t3">{mat.pair}</span>
                    </ListRow>
                  ))}
                </List>
              </>
            )}
            {error && <Alert><AlertTitle>The event did not finish</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>}
          </div>
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Keep scoring</Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onFinish}>Finish event</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
