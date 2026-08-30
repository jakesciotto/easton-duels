import { useEffect, useState, type FormEvent } from 'react'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail } from '@/lib/types'
import { athleteName } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const sel = 'h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-[color,background-color,box-shadow] duration-150 focus-visible:border-transparent focus-visible:shadow-focus disabled:opacity-50'

export function AddMatchDialog({ detail, open, onOpenChange }: { detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [teamA, teamB] = detail.teams
  const [aId, setAId] = useState('')
  const [bId, setBId] = useState('')
  const [rulesetId, setRulesetId] = useState('')
  const [length, setLength] = useState('')
  const [matId, setMatId] = useState('')
  const create = useAdminMutation(detail.event.id, (body: unknown) => adminApi(`/api/events/${detail.event.id}/matches`, { method: 'POST', body }))

  useEffect(() => {
    if (!open) return
    setAId('')
    setBId('')
    setRulesetId(String(detail.rulesets[0]?.id ?? ''))
    setLength(String(detail.rulesets[0]?.defaultLengthSec ?? 300))
    setMatId('')
    create.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const kids = (teamId: number) => detail.athletes.filter(a => a.teamId === teamId).sort((x, y) => x.lastName.localeCompare(y.lastName))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate(
      { athleteAId: Number(aId), athleteBId: Number(bId), rulesetId: Number(rulesetId), lengthSec: Number(length), matId: matId ? Number(matId) : undefined },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid min-h-0">
          <DialogHeader><DialogTitle>Add match</DialogTitle></DialogHeader>
          <DialogBody className="sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="am-a">{teamA.name} kid</Label>
              <select id="am-a" required className={sel} value={aId} onChange={e => setAId(e.target.value)}>
                <option value="">Pick</option>
                {kids(teamA.id).map(k => <option key={k.id} value={k.id}>{athleteName(k)}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="am-b">{teamB.name} kid</Label>
              <select id="am-b" required className={sel} value={bId} onChange={e => setBId(e.target.value)}>
                <option value="">Pick</option>
                {kids(teamB.id).map(k => <option key={k.id} value={k.id}>{athleteName(k)}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="am-rs">Ruleset</Label>
              <select
                id="am-rs" className={sel} value={rulesetId}
                onChange={e => {
                  setRulesetId(e.target.value)
                  const r = detail.rulesets.find(x => String(x.id) === e.target.value)
                  if (r) setLength(String(r.defaultLengthSec))
                }}
              >
                {detail.rulesets.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="am-len">Length (seconds)</Label>
              <Input id="am-len" type="number" min={30} max={1800} required className="font-mono tabular" value={length} onChange={e => setLength(e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="am-mat">Mat</Label>
              <select id="am-mat" className={sel} value={matId} onChange={e => setMatId(e.target.value)}>
                <option value="">Least loaded</option>
                {detail.mats.map(m => <option key={m.id} value={m.id}>Mat {m.number}</option>)}
              </select>
            </div>
            {create.error && <p role="alert" className="text-[13px] text-destructive sm:col-span-2">{create.error.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>Add match</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
