import { useEffect, useState, type FormEvent } from 'react'
import { DEFAULT_LENGTH_SEC, type RulesetAction, type RulesetTerminal, type WinType } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail, RulesetRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const WIN_TYPE_ITEMS: { value: WinType; label: string }[] = [
  { value: 'submission', label: 'submission' },
  { value: 'points', label: 'points' },
  { value: 'decision', label: 'decision' },
]

const slug = (label: string) => label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'action'

function uniqueKeys<T extends { key: string }>(rows: T[]): T[] {
  const seen = new Map<string, number>()
  return rows.map(r => {
    const n = (seen.get(r.key) ?? 0) + 1
    seen.set(r.key, n)
    return n === 1 ? r : { ...r, key: `${r.key}_${n}` }
  })
}

export function RulesetDialog({ detail, open, onOpenChange, ruleset }: { detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void; ruleset?: RulesetRow }) {
  const eventId = detail.event.id
  const [name, setName] = useState('')
  const [length, setLength] = useState(String(DEFAULT_LENGTH_SEC))
  const [actions, setActions] = useState<RulesetAction[]>([])
  const [terminals, setTerminals] = useState<RulesetTerminal[]>([])

  const save = useAdminMutation(eventId, (body: unknown) => ruleset
    ? adminApi(`/api/rulesets/${ruleset.id}`, { method: 'PATCH', body })
    : adminApi(`/api/events/${eventId}/rulesets`, { method: 'POST', body }))

  useEffect(() => {
    if (!open) return
    setName(ruleset?.name ?? '')
    setLength(String(ruleset?.defaultLengthSec ?? DEFAULT_LENGTH_SEC))
    setActions(ruleset?.actions ?? [{ key: 'takedown', label: 'Takedown', points: 2 }])
    setTerminals(ruleset?.terminals ?? [{ key: 'submission', label: 'Submission', winType: 'submission' }])
    save.reset()
  }, [open, ruleset])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({
      name: name.trim(),
      defaultLengthSec: Number(length),
      actions: uniqueKeys(actions.map(a => ({ ...a, key: slug(a.label), label: a.label.trim() }))),
      terminals: uniqueKeys(terminals.map(t => ({ ...t, key: slug(t.label), label: t.label.trim() }))),
    }, {
      onSuccess: () => onOpenChange(false),
    })
  }

  const setAction = (i: number, patch: Partial<RulesetAction>) => setActions(rows => rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  const setTerminal = (i: number, patch: Partial<RulesetTerminal>) => setTerminals(rows => rows.map((r, j) => j === i ? { ...r, ...patch } : r))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid min-h-0">
          <DialogHeader><DialogTitle>{ruleset ? 'Edit ruleset' : 'New ruleset'}</DialogTitle></DialogHeader>
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="rs-name">Name</Label>
                <Input id="rs-name" required value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rs-len">Length (seconds)</Label>
                <Input id="rs-len" type="number" min={30} max={1800} required className="font-mono tabular-nums" value={length} onChange={e => setLength(e.target.value)} />
              </div>
            </div>
            <fieldset className="grid gap-3">
              <legend className="label">Actions (tap to score)</legend>
              {actions.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input aria-label="Action label" required value={a.label} onChange={e => setAction(i, { label: e.target.value })} />
                  <Input aria-label="Action points" type="number" min={-20} max={20} required className="w-20 font-mono tabular-nums" value={a.points} onChange={e => setAction(i, { points: Number(e.target.value) })} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setActions(rows => rows.filter((_, j) => j !== i))} disabled={actions.length === 1}>Remove</Button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setActions(rows => [...rows, { key: '', label: '', points: 2 }])} disabled={actions.length >= 12} className="w-fit">Add action</Button>
            </fieldset>
            <fieldset className="grid gap-3">
              <legend className="label">Terminals (end the match)</legend>
              {terminals.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input aria-label="Terminal label" required value={t.label} onChange={e => setTerminal(i, { label: e.target.value })} />
                  <Select value={t.winType} onValueChange={winType => { if (winType) setTerminal(i, { winType }) }} items={WIN_TYPE_ITEMS}>
                    <SelectTrigger aria-label="Terminal win type" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WIN_TYPE_ITEMS.map(wt => <SelectItem key={wt.value} value={wt.value}>{wt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setTerminals(rows => rows.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" onClick={() => setTerminals(rows => [...rows, { key: '', label: '', winType: 'submission' }])} disabled={terminals.length >= 6} className="w-fit">Add terminal</Button>
            </fieldset>
            {save.error && <p role="alert" className="text-[13px] text-destructive">{save.error.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save ruleset</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
