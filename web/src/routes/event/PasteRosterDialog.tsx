import { useMemo, useState } from 'react'
import { writeErrorMessage } from '@/lib/eventMode'
import { FIELD_LABEL, parseRosterPaste, type Field, type PasteMapping } from '@/lib/roster-paste'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail, ManualKid } from '@/lib/types'
import { beltLabel, genderLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** 4.2. The header case names its columns and, when any were dropped, names those too. */
function mappingLine(mapping: PasteMapping): string {
  if (!mapping.header) return 'No header row. Reading First Last, age, weight, belt, gender.'
  const columns = mapping.columns.filter((f): f is Field => f !== null).map(f => FIELD_LABEL[f]).join(', ')
  const ignored = mapping.ignored.length > 0 ? ` Ignored: ${mapping.ignored.join(', ')}.` : ''
  return `Columns: ${columns}.${ignored}`
}

export function PasteRosterDialog({ detail, open, onOpenChange }: { detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState('')
  const [teamId, setTeamId] = useState<number | null>(null)
  const parsed = useMemo(() => parseRosterPaste(text, detail.teams), [text, detail.teams])
  const { lines, mapping } = parsed
  const hasTeamColumn = mapping.columns.includes('team')
  const add = useAdminMutation(detail.event.id, (bulk: ManualKid[]) => adminApi(`/api/events/${detail.event.id}/athletes`, { method: 'POST', body: { bulk } }))
  const teamItems = [{ value: null as number | null, label: 'Unassigned' }, ...detail.teams.map(t => ({ value: t.id as number | null, label: t.name }))]
  const count = parsed.rows.length

  const submit = () => {
    add.mutate(parsed.rows.map(r => ({ ...r, teamId: hasTeamColumn ? (r.teamId ?? null) : teamId })), {
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
          <p className="t2 text-gray-11">One competitor per line. Paste from a spreadsheet with a header row, or type <code className="fig text-gray-10">First Last, age, weight, belt, gender</code>.</p>
          <Textarea
            aria-label="Roster text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'Mateo Rivera, 8, 62, grey, M\nOlivia Kim, 8, 60, grey/white, F'}
            className="font-mono"
          />
          <div className="flex items-center gap-3">
            <Label htmlFor="paste-team">Put them on</Label>
            <Select value={teamId} onValueChange={setTeamId} items={teamItems} disabled={hasTeamColumn}>
              <SelectTrigger id="paste-team" className="w-48" title={hasTeamColumn ? 'The paste has a Team column' : undefined}><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                {teamItems.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {lines.length > 0 && <p className="t2 text-gray-10">{mappingLine(mapping)}</p>}

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
                        {/* A missing value is a state, not a value: it renders in the
                            attend colour, the way the roster row marks the same gap. It
                            used to inherit white and read brighter than the name. */}
                        <TableCell numeric className={l.row?.age == null ? 'text-attend' : undefined}>{l.row?.age ?? '--'}</TableCell>
                        <TableCell numeric className={l.row?.weightLbs == null ? 'text-attend' : undefined}>{l.row?.weightLbs ?? '--'}</TableCell>
                        <TableCell className="text-gray-11">{beltLabel(l.row?.belt ?? null)}</TableCell>
                        <TableCell className={l.row?.gender ? 'text-gray-11' : 'text-gray-10'}>{genderLabel(l.row?.gender ?? null) ?? '--'}</TableCell>
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
              <AlertDescription>{writeErrorMessage(add.error)}</AlertDescription>
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
