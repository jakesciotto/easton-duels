import { useEffect, useState } from 'react'
import type { AthleteRow, EventDetail } from '@/lib/types'
import { athleteName, beltLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SetupSteps } from '@/components/SetupSteps'
import { TeamPlate } from '@/components/TeamPlate'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Button } from '@/components/ui/button'
import { List, ListRow } from '@/components/ui/list'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PasteRosterDialog } from './PasteRosterDialog'
import { SyncRosterDialog } from './SyncRosterDialog'

/** Enough of the roster to prove the import landed, without turning the step into the tab. */
const SHOWN = 3

type SubStep = 'sync' | 'paste' | null

/** What the roster row prints under a name: the two facts the matcher pairs on. */
export function rosterLine(kid: AthleteRow): string {
  const belt = beltLabel(kid.belt)
  return kid.age === null ? belt : `${belt}, ${kid.age}`
}

function Choice({ title, line, onClick }: { title: string; line: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid gap-1 rounded-lg border border-border bg-gray-1 px-4 py-3.5 text-left transition-[background-color,box-shadow] duration-150 ease-standard outline-none hover:bg-gray-3 focus-visible:shadow-focus active:scale-[0.97] active:bg-gray-4 active:duration-120"
    >
      <span className="t4 text-gray-12">{title}</span>
      <span className="t2 text-gray-10">{line}</span>
    </button>
  )
}

/**
 * Step two. A freshly created event has no competitors and two ways to get some, and both
 * of them lived behind a tab the organizer had no reason to open yet. The step names the
 * two, opens the existing dialog for whichever is picked, and comes back with the count so
 * the roster is a thing that visibly happened rather than a screen to go and check.
 *
 * The WellnessLiving card is kept whatever the event's candidate pool holds, which is where
 * this parts company with the Roster tab's own sync button (hidden once a pool exists). The
 * tab has Add competitor beside it, which reaches the cached pool and offers the re-import
 * inside itself; the step does not, so mirroring the condition would take the only
 * WellnessLiving path off the step the moment a pull returned a pool nobody added from, and
 * 7.10 does not allow a screen with no way out. The dialog itself never pulls on open.
 */
export function SetupRosterStep({ detail, open, onClose, onContinue }: {
  detail: EventDetail
  open: boolean
  onClose: () => void
  onContinue: () => void
}) {
  const [sub, setSub] = useState<SubStep>(null)
  // Closing the step from anywhere puts the sub-step back, so reopening it later never
  // lands straight in a dialog nobody asked for.
  useEffect(() => { if (!open) setSub(null) }, [open])

  const roster = [...detail.athletes].sort((x, y) => x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName))
  const shown = roster.slice(0, SHOWN)
  const more = roster.length - shown.length
  const teamOf = (teamId: number | null) => detail.teams.find(t => t.id === teamId) ?? null

  return (
    <>
      <Dialog open={open && sub === null} onOpenChange={o => { if (!o) onClose() }}>
        <DialogContent className={dialogSurface(576)}>
          <DialogHeader>
            <div className="grid gap-1">
              <DialogTitle>Who is competing?</DialogTitle>
              <SetupSteps current={2} />
            </div>
          </DialogHeader>
          <DialogBody className={dialogBody}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice
                title="Import from WellnessLiving"
                line="Pulls every kid with a rank at the location, then you pick who is in."
                onClick={() => setSub('sync')}
              />
              <Choice
                title="Paste a roster"
                line="One competitor per line, team and belt after the name."
                onClick={() => setSub('paste')}
              />
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="t5 fig text-gray-12">{roster.length}</span>
              <span className="t3 text-gray-11">competitors so far</span>
            </div>
            {roster.length > 0 && (
              <List>
                {shown.map(kid => {
                  const team = teamOf(kid.teamId)
                  return (
                    <ListRow key={kid.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                      {team
                        ? <TeamPlate color={team.color} name={team.name} size="inline" showName={false} />
                        : <span aria-hidden />}
                      <span className="truncate t3">{athleteName(kid)}</span>
                      <span className="shrink-0 t2 text-gray-10">{rosterLine(kid)}</span>
                    </ListRow>
                  )
                })}
                {more > 0 && <ListRow className="t2 text-gray-10">{`and ${more} more on the Roster tab`}</ListRow>}
              </List>
            )}
          </DialogBody>
          <DialogFooter className={cn(dialogFooter, 'justify-between')}>
            <Button type="button" variant="ghost" onClick={onClose}>Skip for now</Button>
            {/* A duel needs two sides. One competitor is a roster the next step cannot pair. */}
            <Button type="button" disabled={roster.length < 2} onClick={onContinue}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* The setup step has no roster rows to act on, so the report is read inside the
          dialog and goes no further. The Roster tab is where it becomes a standing alert. */}
      <SyncRosterDialog detail={detail} open={sub === 'sync'} onOpenChange={o => { if (!o) setSub(null) }} onReport={() => {}} />
      <PasteRosterDialog detail={detail} open={sub === 'paste'} onOpenChange={o => { if (!o) setSub(null) }} />
    </>
  )
}
