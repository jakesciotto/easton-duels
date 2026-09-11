import { useEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from 'react'
import { KIDS_BELTS } from '@shared/types'
import { writeErrorMessage } from '@/lib/eventMode'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail, ManualKid, RosterCandidate } from '@/lib/types'
import { beltLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SEARCH_TOO_SHORT, useWlSearch } from './useWlSearch'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldSet } from '@/components/ui/field-set'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CandidateHead, CandidateRow } from './CandidateRow'

const BELT_ITEMS = [{ value: null as string | null, label: 'No belt' }, ...KIDS_BELTS.map(b => ({ value: b as string | null, label: beltLabel(b) }))]
const GENDER_ITEMS = [{ value: null as string | null, label: 'Not set' }, { value: 'M', label: 'M' }, { value: 'F', label: 'F' }]
const MANUAL_FORM_ID = 'add-competitor-manual-form'

// 6.10: the results are virtualized past 50 rows, because a two token query can match a
// whole belt at a whole gym. CandidateRow renders at the `default` rung (2.7), a fixed
// 40px, so a window can be computed from scroll position without a measurement library.
const RESULT_ROW_H = 40
const RESULT_OVERSCAN = 8
const RESULT_VIRTUALIZE_AT = 50
const RESULT_DEFAULT_ROWS = Math.ceil(320 / RESULT_ROW_H) + RESULT_OVERSCAN

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

export function AddKidDialog({ detail, open, onOpenChange }: {
  detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void
}) {
  const eventId = detail.event.id
  const teamItems = [{ value: null as number | null, label: 'Unassigned' }, ...detail.teams.map(t => ({ value: t.id as number | null, label: t.name }))]

  // A pool the last sync found is the only evidence this screen holds that WellnessLiving
  // answers for this gym at all, so it decides which tab opens. The other tab is one press
  // away either way, and the search reports a 503 itself.
  const [tab, setTab] = useState<'wl' | 'manual'>(detail.candidateCount > 0 ? 'wl' : 'manual')
  const [f, setF] = useState(emptyForm)
  const addManual = useAdminMutation(eventId, (manual: ManualKid) => adminApi(`/api/events/${eventId}/athletes`, { method: 'POST', body: { manual } }))

  const search = useWlSearch(eventId)
  const [teamId, setTeamId] = useState<number | null>(null)
  // Keyed by uid and holding the candidate itself, so a pick made under one query survives
  // the next one: the decision is about a person, not about the words that found them.
  const [picked, setPicked] = useState<Map<string, RosterCandidate>>(new Map())
  const [resultWindow, setResultWindow] = useState<[number, number]>([0, RESULT_DEFAULT_ROWS])
  const addCandidates = useAdminMutation(eventId, (v: { candidates: RosterCandidate[]; teamId: number | null }) =>
    adminApi(`/api/events/${eventId}/athletes`, { method: 'POST', body: v.teamId === null ? { candidates: v.candidates } : { candidates: v.candidates, teamId: v.teamId } }))

  // Every open starts a fresh session for both tabs: the manual form clears and the search
  // opens empty rather than on whoever the last visit was looking for.
  useEffect(() => {
    if (!open) return
    setTab(detail.candidateCount > 0 ? 'wl' : 'manual')
    setF(emptyForm)
    addManual.reset()
    search.setQ('')
    setTeamId(null)
    setPicked(new Map())
    setResultWindow([0, RESULT_DEFAULT_ROWS])
    addCandidates.reset()
  }, [open, eventId])

  const onRoster = useMemo(() => new Set(detail.athletes.map(a => a.wlUid).filter((uid): uid is string => uid !== null)), [detail.athletes])
  // The route orders by how well the name matches, which is the order to keep.
  const visible = useMemo(() => search.results.filter(c => !onRoster.has(c.wlUid)), [search.results, onRoster])

  const toggle = (candidate: RosterCandidate, v: boolean) => setPicked(p => {
    const n = new Map(p)
    if (v) n.set(candidate.wlUid, candidate)
    else n.delete(candidate.wlUid)
    return n
  })

  const virtual = visible.length > RESULT_VIRTUALIZE_AT
  const listRef = useRef<HTMLDivElement | null>(null)
  // A new answer is a new list from the top. Resetting the window alone is not enough: the
  // scrollport keeps its offset, so a second query leaves the reader looking at the spacer
  // below the rows that now exist.
  useEffect(() => {
    setResultWindow([0, RESULT_DEFAULT_ROWS])
    if (listRef.current) listRef.current.scrollTop = 0
  }, [visible])
  const onListScroll = (e: UIEvent<HTMLDivElement>) => {
    if (!virtual) return
    const el = e.currentTarget
    const first = Math.max(0, Math.floor(el.scrollTop / RESULT_ROW_H) - RESULT_OVERSCAN)
    const rows = Math.ceil((el.clientHeight || 320) / RESULT_ROW_H) + RESULT_OVERSCAN * 2
    setResultWindow([first, first + rows])
  }
  const [start, end] = virtual ? resultWindow : [0, visible.length]
  const rows = virtual ? visible.slice(start, end) : visible

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

  const submitPicked = () => {
    addCandidates.mutate({ candidates: [...picked.values()], teamId }, {
      onSuccess: () => {
        setPicked(new Map())
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(576)}>
        <DialogHeader><DialogTitle>Add competitor</DialogTitle></DialogHeader>
        <Tabs value={tab} onValueChange={v => setTab(v as 'wl' | 'manual')} className="min-h-0 gap-0">
          <TabsList className="px-5">
            <TabsTrigger value="wl">From WellnessLiving</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
          </TabsList>
          <DialogBody className={cn(dialogBody, 'flex-1 gap-4')}>
            <TabsContent value="wl" className="grid gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Label htmlFor="wl-search">Search</Label>
                <Input id="wl-search" autoComplete="off" value={search.q} onChange={e => search.setQ(e.target.value)} className="max-w-xs" />
                <Label htmlFor="wl-team">Team</Label>
                <Select value={teamId} onValueChange={setTeamId} items={teamItems}>
                  <SelectTrigger id="wl-team" className="w-40"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    {teamItems.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {search.error === SEARCH_TOO_SHORT && <p className="t2 text-gray-10">{search.error}</p>}
              {search.error !== null && search.error !== SEARCH_TOO_SHORT && (
                <Alert>
                  <AlertTitle>WellnessLiving did not answer</AlertTitle>
                  <AlertDescription>{search.error}</AlertDescription>
                </Alert>
              )}
              {search.error === null && (
                /* 2.6: inner = max(0, 12 - 16) = 0, so the list is flush inside the padded body. */
                <FieldSet ref={listRef} className="max-h-[320px] overflow-y-auto rounded-none" onScroll={onListScroll}>
                  <CandidateHead valueLabel="ERP" />
                  {visible.length === 0
                    ? <EmptyState message={search.pending ? 'Searching WellnessLiving.' : 'No competitors match that name.'} />
                    : (
                      <>
                        {start > 0 && <div aria-hidden style={{ height: start * RESULT_ROW_H }} />}
                        {rows.map(c => (
                          <CandidateRow key={c.wlUid} candidate={c} checked={picked.has(c.wlUid)} onCheckedChange={v => toggle(c, v)} />
                        ))}
                        {end < visible.length && <div aria-hidden style={{ height: (visible.length - end) * RESULT_ROW_H }} />}
                      </>
                    )}
                </FieldSet>
              )}
              {addCandidates.error && (
                <Alert>
                  <AlertTitle>Those competitors were not added</AlertTitle>
                  <AlertDescription>{writeErrorMessage(addCandidates.error)}</AlertDescription>
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
                  <Select value={f.teamId} onValueChange={t => setF({ ...f, teamId: t })} items={teamItems}>
                    <SelectTrigger id="k-team"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      {teamItems.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {addManual.error && (
                  <Alert>
                    <AlertTitle>That competitor was not added</AlertTitle>
                    <AlertDescription>{writeErrorMessage(addManual.error)}</AlertDescription>
                  </Alert>
                )}
              </form>
            </TabsContent>
          </DialogBody>
        </Tabs>
        <DialogFooter className={dialogFooter}>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          {tab === 'wl'
            ? <Button type="button" onClick={submitPicked} disabled={picked.size === 0 || addCandidates.isPending}>Add {picked.size} {picked.size === 1 ? 'competitor' : 'competitors'}</Button>
            : <Button type="submit" form={MANUAL_FORM_ID} disabled={addManual.isPending}>Add competitor</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
