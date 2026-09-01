import { useMemo, useState } from 'react'
import { parseRosterPaste } from '@/lib/roster-paste'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail, ManualKid } from '@/lib/types'
import { beltLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface PreviewLine { n: number; text: string; row: ManualKid | null; problem: string | null }

/**
 * 6.11. The parser reports an error as "line 4: ..." against the whole paste and drops
 * every row once anything fails, which cannot be rendered against the offending line.
 * Re-running it one line at a time gives each line its own verdict for the preview,
 * while the submitted payload still comes from the whole-text parse, so the rule about
 * what is accepted stays in one place.
 */
function preview(text: string): PreviewLine[] {
  return text.split(/\r?\n/)
    .map((line, i) => ({ n: i + 1, text: line }))
    .filter(l => l.text.trim() !== '')
    .map(({ n, text: line }) => {
      const one = parseRosterPaste(line)
      return { n, text: line, row: one.rows[0] ?? null, problem: one.errors[0]?.replace(/^line \d+: /, '') ?? null }
    })
}

export function PasteRosterDialog({ detail, open, onOpenChange }: { detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState('')
  const [teamId, setTeamId] = useState<number | null>(null)
  const parsed = useMemo(() => parseRosterPaste(text), [text])
  const lines = useMemo(() => preview(text), [text])
  const add = useAdminMutation(detail.event.id, (bulk: ManualKid[]) => adminApi(`/api/events/${detail.event.id}/athletes`, { method: 'POST', body: { bulk } }))
  const teamItems = [{ value: null as number | null, label: 'Unassigned' }, ...detail.teams.map(t => ({ value: t.id as number | null, label: t.name }))]
  const count = parsed.rows.length

  const submit = () => {
    add.mutate(parsed.rows.map(r => ({ ...r, teamId })), {
      onSuccess: () => {
        setText('')
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(672)}>
        <DialogHeader><DialogTitle>Paste roster</DialogTitle></DialogHeader>
        <DialogBody className={cn(dialogBody, 'gap-4')}>
          <p className="t2 text-gray-11">One competitor per line: <code className="fig text-gray-10">First Last, age, weight, belt, gender</code>. Everything after the name is optional.</p>
          <Textarea
            aria-label="Roster text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'Mateo Rivera, 8, 62, grey, M\nOlivia Kim, 8, 60, grey/white, F'}
            className="font-mono"
          />
          <div className="flex items-center gap-3">
            <Label htmlFor="paste-team">Put them on</Label>
            <Select value={teamId} onValueChange={setTeamId} items={teamItems}>
              <SelectTrigger id="paste-team" className="w-48"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                {teamItems.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {lines.length > 0 && (
            // finding 4: the caller's vertical scroll folds into Table's own wrapper
            // instead of adding a second scrolling div around it. Two nested scroll
            // containers leave the sticky head stuck to the inner one, which has no
            // scrolling room of its own, so it scrolls away on the first wheel tick.
            <Table wrapperClassName="max-h-[224px] overflow-y-auto">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[var(--col-state)] p-0"><span className="sr-only">Line state</span></TableHead>
                  <TableHead numeric className="w-[var(--col-num-s)]">Line</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead numeric className="w-[var(--col-num-s)]">Age</TableHead>
                  {/* finding 3: "Weight" at the body's own t2 mono step is still wider
                      than the col-num-m track it sits on, so the head keeps overriding
                      it. "lb" is the label the roster and candidate heads already use
                      for this same track. */}
                  <TableHead numeric className="w-[var(--col-num-m)]">lb</TableHead>
                  <TableHead>Belt</TableHead>
                  <TableHead>Gender</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(l => (
                  <TableRow key={l.n}>
                    <TableCell className="w-[var(--col-state)] p-0">
                      <span aria-hidden className={cn('block h-8 w-[var(--col-state)]', l.problem !== null && 'bg-fault')} />
                    </TableCell>
                    <TableCell numeric className="text-gray-10">{l.n}</TableCell>
                    {l.problem !== null ? (
                      <TableCell colSpan={5}>
                        <span className="truncate text-gray-10">{l.text}</span>
                        <span className="ml-3 t2 text-fault">{l.problem}</span>
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className="text-gray-12">{l.row?.firstName} {l.row?.lastName}</TableCell>
                        <TableCell numeric>{l.row?.age ?? '--'}</TableCell>
                        <TableCell numeric>{l.row?.weightLbs ?? '--'}</TableCell>
                        <TableCell className="text-gray-11">{beltLabel(l.row?.belt ?? null)}</TableCell>
                        <TableCell className="text-gray-11">{l.row?.gender ?? '--'}</TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {add.error && (
            <Alert>
              <AlertTitle>That roster was not added</AlertTitle>
              <AlertDescription>{add.error.message}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={add.isPending || count === 0}>Add {count} {count === 1 ? 'competitor' : 'competitors'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
