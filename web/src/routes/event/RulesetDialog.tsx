import { useEffect, useState, type FormEvent } from 'react'
import { XIcon } from 'lucide-react'
import { formatClock } from '@shared/clock'
import { DEFAULT_LENGTH_SEC, type RulesetAction, type RulesetTerminal, type WinType } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail, RulesetRow } from '@/lib/types'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogStack, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { clockToSec, maskClock } from './clock-input'

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

// A penalty prints its sign in the same track as a positive value, which the fixed
// slot makes free. The draft holds what is being typed so a lone "-" survives long
// enough to be finished.
function PointsCell({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      aria-label="Action points"
      inputMode="numeric"
      autoComplete="off"
      value={draft ?? (value > 0 ? `+${value}` : String(value))}
      onFocus={() => setDraft(String(value))}
      onBlur={() => setDraft(null)}
      onChange={e => {
        const raw = e.target.value.replace(/[^-\d]/g, '').replace(/(?!^)-/g, '').slice(0, 3)
        setDraft(raw)
        const n = Number(raw)
        if (raw !== '' && raw !== '-' && Number.isInteger(n) && n >= -20 && n <= 20) onChange(n)
      }}
      className="fig fig-2 h-8 w-[var(--col-num-s)] px-2 text-right"
    />
  )
}

function RemoveCell({ label, onClick, lockedBy }: { label: string; onClick: () => void; lockedBy: string | null }) {
  return (
    <TableCell className="w-[var(--col-act)] px-0">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-label={label}
        title={lockedBy ?? undefined}
        disabled={lockedBy !== null}
        onClick={onClick}
      >
        <XIcon />
      </Button>
    </TableCell>
  )
}

export function RulesetDialog({ detail, open, onOpenChange, ruleset }: { detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void; ruleset?: RulesetRow }) {
  const eventId = detail.event.id
  const [name, setName] = useState('')
  const [length, setLength] = useState(formatClock(DEFAULT_LENGTH_SEC * 1000))
  const [actions, setActions] = useState<RulesetAction[]>([])
  const [terminals, setTerminals] = useState<RulesetTerminal[]>([])

  const save = useAdminMutation(eventId, (body: unknown) => ruleset
    ? adminApi(`/api/rulesets/${ruleset.id}`, { method: 'PATCH', body })
    : adminApi(`/api/events/${eventId}/rulesets`, { method: 'POST', body }))

  useEffect(() => {
    if (!open) return
    setName(ruleset?.name ?? '')
    setLength(formatClock((ruleset?.defaultLengthSec ?? DEFAULT_LENGTH_SEC) * 1000))
    setActions(ruleset?.actions ?? [{ key: 'takedown', label: 'Takedown', points: 2 }])
    setTerminals(ruleset?.terminals ?? [{ key: 'submission', label: 'Submission', winType: 'submission' }])
    save.reset()
  }, [open, ruleset])

  // Refuse rather than ask. Deleting a word this event has already scored with would
  // rewrite settled history, which is the one thing an append-only log must never do.
  // The event log is not on this client, so the lock is per ruleset rather than per
  // action: once any match under it has been scored, its vocabulary is frozen.
  const scored = ruleset ? detail.matches.filter(m => m.rulesetId === ruleset.id && m.status !== 'pending').length : 0
  const lockedBy = scored > 0 ? `Used by ${scored} scored ${scored === 1 ? 'match' : 'matches'}` : null

  const lengthSec = clockToSec(length)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (lengthSec === null) return
    save.mutate({
      name: name.trim(),
      defaultLengthSec: lengthSec,
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
      <DialogContent className={dialogSurface(576)}>
        <form onSubmit={submit} className={dialogStack}>
          <DialogHeader><DialogTitle>{ruleset ? 'Edit ruleset' : 'New ruleset'}</DialogTitle></DialogHeader>
          <DialogBody className={cn(dialogBody, 'gap-4')}>
            <div className="grid gap-2">
              <Label htmlFor="rs-name">Name</Label>
              <Input id="rs-name" required value={name} onChange={e => setName(e.target.value)} />
            </div>

            <section className="grid gap-2" aria-label="Actions">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action, tap to score</TableHead>
                    <TableHead numeric className="w-[var(--col-num-s)]">Points</TableHead>
                    <TableHead className="w-[var(--col-act)] px-0"><span className="sr-only">Remove</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actions.map((a, i) => (
                    <TableRow key={i}>
                      <TableCell className="px-3">
                        <Input aria-label="Action label" required value={a.label} onChange={e => setAction(i, { label: e.target.value })} className="h-8" />
                      </TableCell>
                      <TableCell numeric className="w-[var(--col-num-s)] px-3">
                        <PointsCell value={a.points} onChange={points => setAction(i, { points })} />
                      </TableCell>
                      <RemoveCell
                        label={`Remove ${a.label || 'action'}`}
                        lockedBy={lockedBy ?? (actions.length === 1 ? 'A ruleset needs at least one action' : null)}
                        onClick={() => setActions(rows => rows.filter((_, j) => j !== i))}
                      />
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="px-3">
                      <Button type="button" variant="ghost" size="sm" disabled={actions.length >= 12} onClick={() => setActions(rows => [...rows, { key: '', label: '', points: 2 }])}>Add action</Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {lockedBy && <p className="t2 text-gray-10">{lockedBy}. Removing one would rewrite a settled result.</p>}
            </section>

            <section className="grid gap-2" aria-label="Terminals">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Terminal, ends the match</TableHead>
                    <TableHead className="w-[140px]">Win type</TableHead>
                    <TableHead className="w-[var(--col-act)] px-0"><span className="sr-only">Remove</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terminals.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="px-3">
                        <Input aria-label="Terminal label" required value={t.label} onChange={e => setTerminal(i, { label: e.target.value })} className="h-8" />
                      </TableCell>
                      <TableCell className="w-[140px] px-3">
                        <Select value={t.winType} onValueChange={winType => { if (winType) setTerminal(i, { winType }) }} items={WIN_TYPE_ITEMS}>
                          <SelectTrigger aria-label="Terminal win type" className="h-8 w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {WIN_TYPE_ITEMS.map(wt => <SelectItem key={wt.value} value={wt.value}>{wt.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <RemoveCell
                        label={`Remove ${t.label || 'terminal'}`}
                        lockedBy={lockedBy}
                        onClick={() => setTerminals(rows => rows.filter((_, j) => j !== i))}
                      />
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="px-3">
                      <Button type="button" variant="ghost" size="sm" disabled={terminals.length >= 6} onClick={() => setTerminals(rows => [...rows, { key: '', label: '', winType: 'submission' }])}>Add terminal</Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </section>

            <div className="grid gap-2">
              <Label htmlFor="rs-len">Default length (m:ss)</Label>
              <Input
                id="rs-len"
                required
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={lengthSec === null || undefined}
                value={length}
                onChange={e => setLength(maskClock(e.target.value))}
                className="fig fig-4 w-[var(--col-num-l)] text-right"
              />
              {lengthSec === null && <p className="t2 text-gray-10">Between 0:30 and 30:00.</p>}
            </div>

            {save.error && (
              <Alert>
                <AlertTitle>That ruleset was not saved</AlertTitle>
                <AlertDescription>{save.error.message}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter className={dialogFooter}>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={lengthSec === null || save.isPending}>Save ruleset</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
