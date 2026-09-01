import { useEffect, useMemo, useRef, useState } from 'react'
import { formatClock } from '@shared/clock'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { ApiError } from '@/lib/api'
import type { EventDetail, RosterCandidate } from '@/lib/types'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldSet } from '@/components/ui/field-set'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CandidateHead, CandidateRow } from './CandidateRow'

interface Location { kBusiness: string; title: string; city: string }

// The server's own budget for a multi-location report. 28 times Nielsen's 10 second
// attention limit, which is why this dialog owes the operator a percent-done readout
// and an interrupt rather than a spinner.
export const SYNC_DEADLINE_MS = 280_000

/**
 * The sync endpoint is one all-or-nothing POST that replaces the cached pool wholesale,
 * so there is no per-location progress to read and splitting the pull into one request
 * per location would leave the cache holding only the last one. The honest determinate
 * measure is the budget the pull has spent, which is monotone, bounded, and the same
 * number the server gives up on.
 */
export function pullProgress(elapsedMs: number): number {
  return Math.min(100, Math.round((elapsedMs / SYNC_DEADLINE_MS) * 100))
}

export function inFlightCopy(titles: string[]): string {
  if (titles.length === 0) return 'no locations'
  if (titles.length <= 2) return titles.join(' and ')
  return `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`
}

export function SyncRosterDialog({ detail, open, onOpenChange }: { detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const eventId = detail.event.id
  const [locations, setLocations] = useState<Location[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<RosterCandidate[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [stopped, setStopped] = useState(false)
  const already = useMemo(() => new Set(detail.athletes.map(a => a.wlUid).filter((uid): uid is string => uid !== null)), [detail.athletes])
  const add = useAdminMutation(eventId, (cands: RosterCandidate[]) => adminApi(`/api/events/${eventId}/athletes`, { method: 'POST', body: { candidates: cands } }))
  // pull() runs from a button click, not the effect below, so a plain boolean ignore flag isn't
  // enough: closing then reopening before a pull resolves would reset the flag along with
  // everything else, and the stale response would land anyway. A generation counter that only
  // ever increases survives any number of closes and reopens across the same pull, and Stop
  // bumps it too, so an abandoned pull can never repopulate the list behind the operator.
  const generation = useRef(0)

  useEffect(() => {
    if (!open) return
    let ignore = false
    generation.current += 1
    setError(null)
    setLocations(null)
    setPicked(new Set())
    setCandidates(null)
    setWarnings([])
    setSelected(new Set())
    setSearch('')
    setStartedAt(null)
    setElapsed(0)
    setStopped(false)
    add.reset()
    adminApi<Location[]>(`/api/events/${eventId}/wl-locations`)
      .then(locs => {
        if (ignore) return
        setLocations(locs)
        setPicked(new Set(locs.map(l => l.kBusiness)))
      })
      .catch(e => { if (!ignore) setError(e instanceof ApiError ? e.message : 'Could not reach the server') })
    return () => { ignore = true }
  }, [open, eventId])

  useEffect(() => {
    if (startedAt === null) return
    const t = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000)
    return () => window.clearInterval(t)
  }, [startedAt])

  const pulling = startedAt !== null
  const pull = async () => {
    const myGeneration = generation.current
    setStartedAt(Date.now())
    setElapsed(0)
    setStopped(false)
    setError(null)
    try {
      const r = await adminApi<{ candidates: RosterCandidate[]; warnings: string[] }>(`/api/events/${eventId}/roster/sync`, { method: 'POST', body: { kBusinesses: [...picked] } })
      if (generation.current !== myGeneration) return
      setCandidates(r.candidates)
      setWarnings(r.warnings)
      setSelected(new Set())
    } catch (e) {
      if (generation.current === myGeneration) setError(e instanceof ApiError ? e.message : 'Could not reach the server')
    } finally {
      if (generation.current === myGeneration) setStartedAt(null)
    }
  }

  const stop = () => {
    generation.current += 1
    setStartedAt(null)
    setStopped(true)
  }

  const pickedTitles = (locations ?? []).filter(l => picked.has(l.kBusiness)).map(l => l.title)
  const visible = (candidates ?? []).filter(c => `${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase()))
  const toggle = (uid: string, v: boolean) => setSelected(s => {
    const n = new Set(s)
    if (v) n.add(uid)
    else n.delete(uid)
    return n
  })
  const submit = () => {
    add.mutate((candidates ?? []).filter(c => selected.has(c.wlUid)), {
      onSuccess: () => onOpenChange(false),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(672)}>
        <DialogHeader><DialogTitle>Sync roster from WellnessLiving</DialogTitle></DialogHeader>
        <DialogBody className={cn(dialogBody, 'gap-2')}>
          {error && (
            <Alert>
              <AlertTitle>WellnessLiving did not answer</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {locations && (
            <div className="flex flex-wrap items-center gap-3">
              {locations.map(l => (
                <span key={l.kBusiness} className="flex items-center gap-2 t2 text-gray-11">
                  <Checkbox
                    aria-label={l.title}
                    checked={picked.has(l.kBusiness)}
                    onCheckedChange={checked => setPicked(s => {
                      const n = new Set(s)
                      if (checked) n.add(l.kBusiness)
                      else n.delete(l.kBusiness)
                      return n
                    })}
                  />
                  {l.title}
                </span>
              ))}
              <Button size="sm" onClick={pull} disabled={pulling || picked.size === 0}>Pull roster</Button>
            </div>
          )}

          {pulling && (
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
                  Pulling {inFlightCopy(pickedTitles)}.{' '}
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
              <AlertDescription>WellnessLiving may still be working. Pull again, or reopen this dialog later to see the pool.</AlertDescription>
            </Alert>
          )}

          {warnings.length > 0 && (
            <Alert variant="attend">
              <AlertTitle variant="attend">The pull came back with gaps</AlertTitle>
              <AlertDescription>{warnings.join(' ')}</AlertDescription>
            </Alert>
          )}

          {candidates && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Label htmlFor="cand-search">Search</Label>
                <Input id="cand-search" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
                <span className="t2 text-gray-10"><span className="fig text-gray-11">{candidates.length}</span> competitors found</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set(visible.map(c => c.wlUid)))}>Select shown</Button>
              </div>
              <FieldSet className="max-h-80 overflow-y-auto">
                <CandidateHead valueLabel="ERP" />
                {visible.length === 0
                  ? <EmptyState message="No competitors match. Clear the search." action={<Button size="sm" variant="ghost" onClick={() => setSearch('')}>Clear search</Button>} />
                  : visible.map(c => (
                    <CandidateRow
                      key={c.wlUid}
                      candidate={c}
                      checked={selected.has(c.wlUid)}
                      onCheckedChange={v => toggle(c.wlUid, v)}
                      meta={
                        <>
                          <span className="truncate t2 text-gray-10">{c.wlLocation}</span>
                          {already.has(c.wlUid) && <Badge variant="done">on roster</Badge>}
                        </>
                      }
                    />
                  ))}
              </FieldSet>
            </>
          )}

          {add.error && (
            <Alert>
              <AlertTitle>Those competitors were not added</AlertTitle>
              <AlertDescription>{add.error.message}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={submit} disabled={selected.size === 0 || add.isPending}>Add {selected.size} {selected.size === 1 ? 'competitor' : 'competitors'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
