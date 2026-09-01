import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { KIDS_BELTS } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { ApiError } from '@/lib/api'
import type { EventDetail, ManualKid, RosterCandidate } from '@/lib/types'
import { beltLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldSet } from '@/components/ui/field-set'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CandidateHead, CandidateRow } from './CandidateRow'

const BELT_ITEMS = [{ value: null as string | null, label: 'No belt' }, ...KIDS_BELTS.map(b => ({ value: b as string | null, label: beltLabel(b) }))]
const GENDER_ITEMS = [{ value: null as string | null, label: 'Not set' }, { value: 'M', label: 'M' }, { value: 'F', label: 'F' }]
const MANUAL_FORM_ID = 'add-competitor-manual-form'

interface FormState {
  firstName: string
  lastName: string
  age: string
  weightLbs: string
  belt: string | null
  gender: string | null
  teamId: number | null
}
const emptyForm: FormState = { firstName: '', lastName: '', age: '', weightLbs: '', belt: null, gender: null, teamId: null }

export function AddKidDialog({ detail, open, onOpenChange, onRefresh }: {
  detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void; onRefresh: () => void
}) {
  const eventId = detail.event.id
  const teamItems = [{ value: null as number | null, label: 'Unassigned' }, ...detail.teams.map(t => ({ value: t.id as number | null, label: t.name }))]

  const [tab, setTab] = useState<'pool' | 'manual'>(detail.candidateCount > 0 ? 'pool' : 'manual')
  const [f, setF] = useState(emptyForm)
  const addManual = useAdminMutation(eventId, (manual: ManualKid) => adminApi(`/api/events/${eventId}/athletes`, { method: 'POST', body: { manual } }))

  const [pool, setPool] = useState<RosterCandidate[] | null>(null)
  const [poolError, setPoolError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showUnrated, setShowUnrated] = useState(false)
  const [poolTeamId, setPoolTeamId] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const addCandidates = useAdminMutation(eventId, (v: { candidates: RosterCandidate[]; teamId: number | null }) =>
    adminApi(`/api/events/${eventId}/athletes`, { method: 'POST', body: v.teamId === null ? { candidates: v.candidates } : { candidates: v.candidates, teamId: v.teamId } }))

  // Every open starts a fresh session for both tabs: the manual form clears, the pool
  // refetches, and a stale response from a closed-then-reopened dialog is dropped.
  useEffect(() => {
    if (!open) return
    let ignore = false
    setTab(detail.candidateCount > 0 ? 'pool' : 'manual')
    setF(emptyForm)
    addManual.reset()
    setPool(null)
    setPoolError(null)
    setSearch('')
    setShowUnrated(false)
    setPoolTeamId(null)
    setPicked(new Set())
    addCandidates.reset()
    adminApi<RosterCandidate[]>(`/api/events/${eventId}/candidates`)
      .then(rows => { if (!ignore) setPool(rows) })
      .catch(e => { if (!ignore) setPoolError(e instanceof ApiError ? e.message : 'Could not reach the server') })
    return () => { ignore = true }
  }, [open, eventId])

  const onRoster = useMemo(() => new Set(detail.athletes.map(a => a.wlUid).filter((uid): uid is string => uid !== null)), [detail.athletes])
  const available = useMemo(() => (pool ?? []).filter(c => !onRoster.has(c.wlUid)), [pool, onRoster])
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q === '' ? available : available.filter(c => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q))
  }, [available, search])
  const rated = useMemo(() => [...searched].filter(c => c.erp !== null).sort((a, b) => (b.erp as number) - (a.erp as number)), [searched])
  const unrated = useMemo(() => [...searched].filter(c => c.erp === null).sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)), [searched])
  const visible = showUnrated ? [...rated, ...unrated] : rated

  const toggle = (uid: string, v: boolean) => setPicked(s => {
    const n = new Set(s)
    if (v) n.add(uid)
    else n.delete(uid)
    return n
  })

  const submitManual = (e: FormEvent) => {
    e.preventDefault()
    addManual.mutate({
      firstName: f.firstName.trim(), lastName: f.lastName.trim(),
      age: f.age ? Number(f.age) : null, weightLbs: f.weightLbs ? Number(f.weightLbs) : null,
      belt: f.belt, gender: f.gender, teamId: f.teamId,
    }, {
      onSuccess: () => {
        setF(emptyForm)
        onOpenChange(false)
      },
    })
  }

  const submitPool = () => {
    const chosen = (pool ?? []).filter(c => picked.has(c.wlUid))
    addCandidates.mutate({ candidates: chosen, teamId: poolTeamId }, {
      onSuccess: () => {
        setPicked(new Set())
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(576)}>
        <DialogHeader><DialogTitle>Add competitor</DialogTitle></DialogHeader>
        <Tabs value={tab} onValueChange={v => setTab(v as 'pool' | 'manual')} className="min-h-0 gap-0">
          <TabsList className="px-5">
            <TabsTrigger value="pool">From pool</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
          </TabsList>
          <DialogBody className={cn(dialogBody, 'flex-1 gap-4')}>
            <TabsContent value="pool" className="grid gap-4">
              {poolError && (
                <Alert>
                  <AlertTitle>The pool did not load</AlertTitle>
                  <AlertDescription>{poolError}</AlertDescription>
                </Alert>
              )}
              {pool !== null && pool.length === 0 ? (
                <FieldSet className="rounded-none">
                  <EmptyState
                    message="No pool yet. Import one from WellnessLiving."
                    action={<Button size="sm" variant="ghost" onClick={onRefresh}>Sync from WellnessLiving</Button>}
                  />
                </FieldSet>
              ) : pool !== null && (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <Label htmlFor="pool-search">Search</Label>
                    <Input id="pool-search" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
                    <Label htmlFor="pool-team">Team</Label>
                    <Select value={poolTeamId} onValueChange={setPoolTeamId} items={teamItems}>
                      <SelectTrigger id="pool-team" className="w-40"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        {teamItems.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="t2 text-gray-10">
                      <span className="fig text-gray-11">{visible.length}</span> of <span className="fig text-gray-11">{available.length}</span> shown, rated first
                    </span>
                    <span className="ml-auto flex items-center gap-2 t2 text-gray-11">
                      <Checkbox aria-label="Show unrated competitors" checked={showUnrated} onCheckedChange={setShowUnrated} />
                      Show unrated
                    </span>
                    <Button size="sm" variant="ghost" onClick={onRefresh}>Refresh from WellnessLiving</Button>
                  </div>
                  {/* 2.6: inner = max(0, 12 - 16) = 0, so the list is flush inside the padded body. */}
                  <FieldSet className="max-h-[320px] overflow-y-auto rounded-none">
                    <CandidateHead valueLabel="ERP" />
                    {visible.length === 0
                      ? <EmptyState
                          message="No competitors match. Clear the search."
                          action={<Button size="sm" variant="ghost" onClick={() => setSearch('')}>Clear search</Button>}
                        />
                      : visible.map(c => (
                        <CandidateRow key={c.wlUid} candidate={c} checked={picked.has(c.wlUid)} onCheckedChange={v => toggle(c.wlUid, v)} />
                      ))}
                  </FieldSet>
                </>
              )}
              {addCandidates.error && (
                <Alert>
                  <AlertTitle>Those competitors were not added</AlertTitle>
                  <AlertDescription>{addCandidates.error.message}</AlertDescription>
                </Alert>
              )}
            </TabsContent>
            <TabsContent value="manual">
              <form id={MANUAL_FORM_ID} onSubmit={submitManual} className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="k-first">First name</Label>
                    <Input id="k-first" required value={f.firstName} onChange={e => setF({ ...f, firstName: e.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="k-last">Last name</Label>
                    <Input id="k-last" required value={f.lastName} onChange={e => setF({ ...f, lastName: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="k-age">Age</Label>
                    <Input
                      id="k-age" inputMode="numeric" autoComplete="off" maxLength={2}
                      className="fig w-[var(--col-num-s)] text-right"
                      value={f.age} onChange={e => setF({ ...f, age: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="k-weight">Weight (lb)</Label>
                    <Input
                      id="k-weight" inputMode="numeric" autoComplete="off" maxLength={3}
                      className="fig w-[var(--col-num-m)] text-right"
                      value={f.weightLbs} onChange={e => setF({ ...f, weightLbs: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="k-belt">Belt</Label>
                    <Select value={f.belt} onValueChange={belt => setF({ ...f, belt })} items={BELT_ITEMS}>
                      <SelectTrigger id="k-belt"><SelectValue placeholder="No belt" /></SelectTrigger>
                      <SelectContent>
                        {BELT_ITEMS.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="k-gender">Gender</Label>
                    <Select value={f.gender} onValueChange={gender => setF({ ...f, gender })} items={GENDER_ITEMS}>
                      <SelectTrigger id="k-gender"><SelectValue placeholder="Not set" /></SelectTrigger>
                      <SelectContent>
                        {GENDER_ITEMS.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="k-team">Team</Label>
                  <Select value={f.teamId} onValueChange={teamId => setF({ ...f, teamId })} items={teamItems}>
                    <SelectTrigger id="k-team"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      {teamItems.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {addManual.error && (
                  <Alert>
                    <AlertTitle>That competitor was not added</AlertTitle>
                    <AlertDescription>{addManual.error.message}</AlertDescription>
                  </Alert>
                )}
              </form>
            </TabsContent>
          </DialogBody>
        </Tabs>
        <DialogFooter className={dialogFooter}>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          {tab === 'pool'
            ? <Button type="button" onClick={submitPool} disabled={picked.size === 0 || addCandidates.isPending}>Add {picked.size} {picked.size === 1 ? 'competitor' : 'competitors'}</Button>
            : <Button type="submit" form={MANUAL_FORM_ID} disabled={addManual.isPending}>Add competitor</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
