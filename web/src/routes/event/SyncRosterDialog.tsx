import { useEffect, useMemo, useRef, useState } from 'react'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { ApiError } from '@/lib/api'
import type { EventDetail } from '@/lib/types'
import { beltLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { List, ListRow } from '@/components/ui/list'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Location { kBusiness: string; title: string; city: string }
interface Candidate {
  wlUid: string
  firstName: string
  lastName: string
  belt: string | null
  wlLocation: string
  leaderboardId: string | null
  erp: number | null
  age: number | null
  weightLbs: number | null
  gender: string | null
}

export function SyncRosterDialog({ detail, open, onOpenChange }: { detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const eventId = detail.event.id
  const [locations, setLocations] = useState<Location[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [pulling, setPulling] = useState(false)
  const already = useMemo(() => new Set(detail.athletes.map(a => a.wlUid).filter((uid): uid is string => uid !== null)), [detail.athletes])
  const add = useAdminMutation(eventId, (cands: Candidate[]) => adminApi(`/api/events/${eventId}/athletes`, { method: 'POST', body: { candidates: cands } }))
  // pull() runs from a button click, not the effect below, so a plain boolean ignore flag isn't
  // enough: closing then reopening before a pull resolves would reset the flag along with
  // everything else, and the stale response would land anyway. A generation counter that only
  // ever increases survives any number of closes and reopens across the same pull.
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
    setPulling(false)
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

  const pull = async () => {
    const myGeneration = generation.current
    setPulling(true)
    setError(null)
    try {
      const r = await adminApi<{ candidates: Candidate[]; warnings: string[] }>(`/api/events/${eventId}/roster/sync`, { method: 'POST', body: { kBusinesses: [...picked] } })
      if (generation.current !== myGeneration) return
      setCandidates(r.candidates)
      setWarnings(r.warnings)
      setSelected(new Set())
    } catch (e) {
      if (generation.current === myGeneration) setError(e instanceof ApiError ? e.message : 'Could not reach the server')
    } finally {
      if (generation.current === myGeneration) setPulling(false)
    }
  }

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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>Sync roster from WellnessLiving</DialogTitle></DialogHeader>
        <DialogBody>
          {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
          {locations && (
            <div className="flex flex-wrap items-center gap-3">
              {locations.map(l => (
                <span key={l.kBusiness} className="flex items-center gap-2 text-sm text-soft">
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
              <Button size="sm" onClick={pull} disabled={pulling || picked.size === 0}>{pulling ? 'Pulling' : 'Pull roster'}</Button>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="flex flex-col items-start gap-2">
              {warnings.map(w => <Badge key={w} variant="warn">{w}</Badge>)}
            </div>
          )}
          {candidates && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Label htmlFor="cand-search">Search</Label>
                <Input id="cand-search" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
                <span className="text-[13px] text-faint"><span className="font-mono tabular-nums">{candidates.length}</span> competitors found</span>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(visible.map(c => c.wlUid)))}>Select shown</Button>
              </div>
              <List className="max-h-80 overflow-y-auto">
                {visible.map(c => (
                  <ListRow key={c.wlUid} className="flex items-center gap-3">
                    <Checkbox aria-label={`Select ${c.firstName} ${c.lastName}`} checked={selected.has(c.wlUid)} onCheckedChange={checked => toggle(c.wlUid, checked)} />
                    <span className="min-w-0 flex-1 truncate font-medium">{c.firstName} {c.lastName}</span>
                    <span className="text-[13px] text-faint">{c.wlLocation}</span>
                    <span className="text-[13px] text-soft">{beltLabel(c.belt)}</span>
                    {c.erp !== null && <Badge>ERP <span className="font-mono tabular-nums">{c.erp.toFixed(1)}</span></Badge>}
                    {c.age !== null && <span className="text-[13px] text-faint">age <span className="font-mono tabular-nums">{c.age}</span></span>}
                    {c.weightLbs !== null && <span className="text-[13px] text-faint"><span className="font-mono tabular-nums">{c.weightLbs}</span> lb</span>}
                    {already.has(c.wlUid) && <Badge variant="done">on roster</Badge>}
                  </ListRow>
                ))}
              </List>
            </>
          )}
          {add.error && <p role="alert" className="text-[13px] text-destructive">{add.error.message}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={submit} disabled={selected.size === 0 || add.isPending}>Add {selected.size} {selected.size === 1 ? 'competitor' : 'competitors'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
