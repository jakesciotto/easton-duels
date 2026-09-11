import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { formatClock } from '@shared/clock'
import { writeErrorMessage } from '@/lib/eventMode'
import { adminApi, qk, useAdminMutation } from '@/lib/queries'
import { ApiError } from '@/lib/api'
import type { EventDetail, RosterCandidate, SyncReport } from '@/lib/types'
import { reportLines } from './link-report'
import { SEARCH_TOO_SHORT, useWlSearch } from './useWlSearch'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldSet } from '@/components/ui/field-set'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CandidateHead, CandidateRow } from './CandidateRow'

/** The route's answer. The pool it replaces is read by name instead, so only these two are used. */
interface SyncAnswer { candidates: RosterCandidate[]; warnings: string[]; report?: SyncReport }

// The server's own budget for a sync over every location. 28 times Nielsen's 10 second
// attention limit, which is why this dialog owes the operator a percent-done readout
// and an interrupt rather than a spinner.
export const SYNC_DEADLINE_MS = 280_000

/**
 * The sync is one all-or-nothing POST that replaces the cached pool wholesale, so there
 * is no per-location progress to read. The honest determinate measure is the budget the
 * sync has spent, which is monotone, bounded, and the same number the server gives up on.
 */
export function pullProgress(elapsedMs: number): number {
  return Math.min(100, Math.round((elapsedMs / SYNC_DEADLINE_MS) * 100))
}

export function SyncRosterDialog({ detail, open, onOpenChange, onReport }: {
  detail: EventDetail
  open: boolean
  onOpenChange: (o: boolean) => void
  /**
   * 7.1. The report is read on the tab, not here, because the organizer acts on it row by
   * row and the dialog covers the rows. It travels on the close rather than on the answer,
   * so the alert never appears behind the surface that produced it.
   */
  onReport: (report: SyncReport) => void
}) {
  const eventId = detail.event.id
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [report, setReport] = useState<SyncReport | null>(null)
  const [answered, setAnswered] = useState(false)
  const [picked, setPicked] = useState<Map<string, RosterCandidate>>(new Map())
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [stopped, setStopped] = useState(false)
  const search = useWlSearch(eventId)
  const already = useMemo(() => new Set(detail.athletes.map(a => a.wlUid).filter((uid): uid is string => uid !== null)), [detail.athletes])
  const add = useAdminMutation(eventId, (cands: RosterCandidate[]) => adminApi(`/api/events/${eventId}/athletes`, { method: 'POST', body: { candidates: cands } }))
  // A plain boolean ignore flag is not enough here: closing then reopening before a sync
  // resolves would reset the flag along with everything else, and the stale response would
  // land anyway. A generation counter that only ever increases survives any number of
  // closes and reopens across the same sync, and Stop bumps it too, so an abandoned sync
  // can never report behind the operator.
  const generation = useRef(0)
  const qc = useQueryClient()

  const sync = useCallback(async () => {
    const mine = generation.current
    setStartedAt(Date.now())
    setElapsed(0)
    setStopped(false)
    setError(null)
    try {
      const r = await adminApi<SyncAnswer>(`/api/events/${eventId}/roster/sync`, { method: 'POST' })
      if (generation.current !== mine) return
      setWarnings(r.warnings)
      setReport(r.report ?? null)
      setAnswered(true)
      // The sync links what it can, so the roster behind this dialog is stale the moment
      // it lands: the "on roster" badge reads it.
      await qc.invalidateQueries({ queryKey: qk.event(eventId) })
    } catch (e) {
      if (generation.current === mine) setError(e instanceof ApiError ? e.message : 'Could not reach the server')
    } finally {
      if (generation.current === mine) setStartedAt(null)
    }
  }, [eventId, qc])

  // Spec 4: opening the dialog is the press. The filter is the roster itself, so there is
  // nothing to pick first.
  useEffect(() => {
    if (!open) return
    generation.current += 1
    setError(null)
    setWarnings([])
    setReport(null)
    setAnswered(false)
    setPicked(new Map())
    setElapsed(0)
    setStopped(false)
    search.setQ('')
    add.reset()
    void sync()
  }, [open, eventId])

  useEffect(() => {
    if (startedAt === null) return
    const t = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000)
    return () => window.clearInterval(t)
  }, [startedAt])

  const running = startedAt !== null
  const stop = () => {
    generation.current += 1
    setStartedAt(null)
    setStopped(true)
  }

  const toggle = (candidate: RosterCandidate, v: boolean) => setPicked(p => {
    const n = new Map(p)
    if (v) n.set(candidate.wlUid, candidate)
    else n.delete(candidate.wlUid)
    return n
  })
  // Every way out runs through here: the Close button, Escape, the backdrop, and the add
  // that closes on success. A report the operator never sees would be a run with no answer.
  const close = (o: boolean) => {
    if (!o && report !== null) onReport(report)
    onOpenChange(o)
  }
  const submit = () => {
    add.mutate([...picked.values()], { onSuccess: () => close(false) })
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={dialogSurface(672)}>
        <DialogHeader><DialogTitle>Sync from WellnessLiving</DialogTitle></DialogHeader>
        <DialogBody className={cn(dialogBody, 'gap-2')}>
          {error && (
            <Alert>
              <AlertTitle>WellnessLiving did not answer</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {running && (
            <div className="grid gap-2 bg-gray-1 px-4 py-3">
              <div
                role="progressbar"
                aria-label="Roster sync"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pullProgress(elapsed)}
                className="h-0.5 w-full bg-gray-6"
              >
                <span className="block h-full bg-gray-11 transition-[width] duration-200 ease-standard" style={{ width: `${pullProgress(elapsed)}%` }} />
              </div>
              <div className="flex items-center gap-3">
                <p className="t2 text-gray-11">
                  Searching WellnessLiving.{' '}
                  <span className="fig text-gray-10">{formatClock(elapsed)}</span>
                  <span className="text-gray-9"> of </span>
                  <span className="fig text-gray-10">{formatClock(SYNC_DEADLINE_MS)}</span>
                </p>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={stop}>Stop</Button>
              </div>
            </div>
          )}
          {stopped && (
            <Alert variant="attend">
              <AlertTitle variant="attend">Stopped waiting</AlertTitle>
              <AlertDescription>WellnessLiving may still be working. Sync again to ask once more.</AlertDescription>
            </Alert>
          )}

          {warnings.length > 0 && (
            <Alert variant="attend">
              <AlertTitle variant="attend">The sync came back with gaps</AlertTitle>
              <AlertDescription>{warnings.join(' ')}</AlertDescription>
            </Alert>
          )}

          {report && (
            <div className="grid gap-1">
              {reportLines(report).map(line => <p key={line} className="t2 text-gray-11">{line}</p>)}
            </div>
          )}

          {!running && (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary" onClick={sync}>Sync again</Button>
            </div>
          )}

          {answered && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="wl-add">Add from WellnessLiving</Label>
                <Input id="wl-add" autoComplete="off" value={search.q} onChange={e => search.setQ(e.target.value)} className="max-w-xs" />
              </div>
              {search.error === SEARCH_TOO_SHORT && <p className="t2 text-gray-10">{search.error}</p>}
              {search.error !== null && search.error !== SEARCH_TOO_SHORT && (
                <Alert>
                  <AlertTitle>WellnessLiving did not answer</AlertTitle>
                  <AlertDescription>{search.error}</AlertDescription>
                </Alert>
              )}
              {search.error === null && (
                <FieldSet className="max-h-80 overflow-y-auto">
                  <CandidateHead valueLabel="ERP" />
                  {search.results.length === 0
                    ? <EmptyState message={search.pending ? 'Searching WellnessLiving.' : 'No competitors match that name.'} />
                    : search.results.map(c => (
                      <CandidateRow
                        key={c.wlUid}
                        candidate={c}
                        checked={picked.has(c.wlUid)}
                        onCheckedChange={v => toggle(c, v)}
                        meta={
                          <>
                            <span className="truncate t2 text-gray-10">{c.wlLocation}</span>
                            {already.has(c.wlUid) && <Badge variant="done">on roster</Badge>}
                          </>
                        }
                      />
                    ))}
                </FieldSet>
              )}
            </>
          )}

          {add.error && (
            <Alert>
              <AlertTitle>Those competitors were not added</AlertTitle>
              <AlertDescription>{writeErrorMessage(add.error)}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button variant="ghost" onClick={() => close(false)}>Close</Button>
          <Button onClick={submit} disabled={picked.size === 0 || add.isPending}>Add {picked.size} {picked.size === 1 ? 'competitor' : 'competitors'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
