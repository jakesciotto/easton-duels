import { useEffect, useMemo } from 'react'
import { writeErrorMessage } from '@/lib/eventMode'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { athleteName, beltLabel } from '@/lib/format'
import type { AthleteRow, EventDetail, RosterCandidate } from '@/lib/types'
import { cn } from '@/lib/utils'
import { SEARCH_TOO_SHORT, useWlSearch } from './useWlSearch'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { List, ListRow } from '@/components/ui/list'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export const LINK_TITLE = 'Link to WellnessLiving'

/** What the roster holds for this competitor, so the picker is read against it. */
export function linkedRowLine(kid: AthleteRow): string {
  return [
    athleteName(kid),
    beltLabel(kid.belt),
    kid.age === null ? null : String(kid.age),
    kid.weightLbs === null ? null : `${kid.weightLbs} lb`,
  ].filter(v => v !== null).join(', ')
}

const candidateName = (c: RosterCandidate): string => `${c.firstName} ${c.lastName}`

/**
 * Spec 5.3. The sync links a name it finds exactly once. Everything else is a person's
 * decision, so this is the screen that decision is made on: WellnessLiving asked for the
 * row's own last name, nearest that name first, with the location and the rating that tell
 * two children of one name apart.
 *
 * The route only ORDERS the answer. Nothing here links on a score.
 */
export function LinkCandidateDialog({ detail, kid, open, onOpenChange }: {
  detail: EventDetail
  kid: AthleteRow | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const eventId = detail.event.id
  const search = useWlSearch(eventId)
  const setQ = search.setQ
  const link = useAdminMutation(eventId, (v: { athleteId: number; wlUid: string }) =>
    adminApi(`/api/athletes/${v.athleteId}/link`, { method: 'POST', body: { wlUid: v.wlUid } }))

  const lastName = kid?.lastName ?? ''
  useEffect(() => {
    if (!open) return
    setQ(lastName)
    link.reset()
  }, [open, eventId, lastName, setQ])

  const onRoster = useMemo(
    () => new Set(detail.athletes.map(a => a.wlUid).filter((uid): uid is string => uid !== null)),
    [detail.athletes],
  )
  const name = kid === null ? '' : athleteName(kid)
  const offered = useMemo(() => search.results.filter(c => !onRoster.has(c.wlUid)), [search.results, onRoster])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(512)}>
        <DialogHeader><DialogTitle>{LINK_TITLE}</DialogTitle></DialogHeader>
        <DialogBody className={dialogBody}>
          {kid && <p className="t2 text-gray-11">{linkedRowLine(kid)}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="link-search">Search</Label>
            <Input id="link-search" autoComplete="off" value={search.q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
          </div>
          {search.error === SEARCH_TOO_SHORT && <p className="t2 text-gray-10">{search.error}</p>}
          {search.error !== null && search.error !== SEARCH_TOO_SHORT && (
            <Alert>
              <AlertTitle>WellnessLiving did not answer</AlertTitle>
              <AlertDescription>{search.error}</AlertDescription>
            </Alert>
          )}
          {search.error === null && (
            <List className="max-h-80 overflow-y-auto">
              {offered.length === 0
                ? <EmptyState message={search.pending ? 'Searching WellnessLiving.' : 'No competitors match that name.'} />
                : offered.map(c => (
                  <ListRow key={c.wlUid} className="p-0">
                    <button
                      type="button"
                      aria-label={`Link ${candidateName(c)} to ${name}`}
                      disabled={link.isPending}
                      onClick={() => kid && link.mutate({ athleteId: kid.id, wlUid: c.wlUid }, { onSuccess: () => onOpenChange(false) })}
                      className="grid w-full grid-cols-[minmax(0,1fr)_var(--col-num-m)] items-center gap-x-3 px-3 py-2.5 text-left outline-none transition-colors duration-120 ease-out hover:bg-gray-3 focus-visible:bg-gray-3 focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate t3 text-gray-12">{candidateName(c)}</span>
                        <span className="block truncate t2 text-gray-10">
                          {[c.wlLocation, beltLabel(c.belt)].filter(v => v !== '').join(' · ')}
                        </span>
                      </span>
                      <span className={cn('fig t2 text-right', c.erp === null ? 'text-gray-9' : 'text-gray-11')}>
                        {c.erp === null ? '--' : c.erp.toFixed(1)}
                      </span>
                    </button>
                  </ListRow>
                ))}
            </List>
          )}
          {link.error && (
            <Alert>
              <AlertTitle>That competitor was not linked</AlertTitle>
              <AlertDescription>{writeErrorMessage(link.error)}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
