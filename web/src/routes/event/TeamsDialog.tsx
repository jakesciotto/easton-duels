import type { TeamColor } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { CERTIFIED_REFUSAL, writeErrorMessage } from '@/lib/eventMode'
import type { EventDetail } from '@/lib/types'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TeamList, type TeamDraft } from './TeamList'

export const TEAMS_NOTE = 'An event holds two to eight teams. A team with a competitor or a match on it cannot be removed.'

/**
 * The same list the New event dialog carries, after creation. The rows exist on the
 * server by now, so they are added and removed rather than retyped: a rename is a
 * different write and nothing on this event asks for one.
 */
export function TeamsDialog({ detail, certified, open, onOpenChange }: {
  detail: EventDetail
  certified: boolean
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const eventId = detail.event.id
  const add = useAdminMutation(eventId, (body: { name: string; color: TeamColor }) =>
    adminApi(`/api/events/${eventId}/teams`, { method: 'POST', body }))
  const remove = useAdminMutation(eventId, (teamId: number) =>
    adminApi(`/api/events/${eventId}/teams/${teamId}`, { method: 'DELETE' }))

  const teams: TeamDraft[] = detail.teams.map(t => ({ id: t.id, name: t.name, color: t.color }))
  // The newest failure wins by the moment it started, so the banner never names the write
  // before last. A certified event refuses both, and says so rather than asking.
  const failure = [
    add.error ? { message: writeErrorMessage(add.error), at: add.submittedAt } : null,
    remove.error ? { message: writeErrorMessage(remove.error), at: remove.submittedAt } : null,
  ].filter((f): f is { message: string; at: number } => f !== null)
    .sort((x, y) => y.at - x.at)[0] ?? null

  const close = () => {
    onOpenChange(false)
    add.reset()
    remove.reset()
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (o) onOpenChange(true); else close() }}>
      <DialogContent className={dialogSurface(640)}>
        <DialogHeader><DialogTitle>Teams</DialogTitle></DialogHeader>
        <DialogBody className={dialogBody}>
          <p className="t3 text-gray-11">{certified ? CERTIFIED_REFUSAL : TEAMS_NOTE}</p>
          <TeamList
            teams={teams}
            locked
            pending={certified || add.isPending || remove.isPending}
            error={failure?.message ?? null}
            onChange={() => {}}
            onAdd={team => add.mutate(team)}
            onRemove={i => { const id = teams[i].id; if (id !== undefined) remove.mutate(id) }}
          />
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button type="button" variant="secondary" onClick={close}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
