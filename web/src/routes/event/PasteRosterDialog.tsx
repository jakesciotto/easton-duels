import { useMemo, useState } from 'react'
import { parseRosterPaste } from '@/lib/roster-paste'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail, ManualKid } from '@/lib/types'
import { beltLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function PasteRosterDialog({ detail, open, onOpenChange }: { detail: EventDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState('')
  const [teamId, setTeamId] = useState<number | null>(null)
  const parsed = useMemo(() => parseRosterPaste(text), [text])
  const add = useAdminMutation(detail.event.id, (bulk: ManualKid[]) => adminApi(`/api/events/${detail.event.id}/athletes`, { method: 'POST', body: { bulk } }))
  const teamItems = [{ value: null as number | null, label: 'Unassigned' }, ...detail.teams.map(t => ({ value: t.id as number | null, label: t.name }))]

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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Paste roster</DialogTitle></DialogHeader>
        <DialogBody>
          <p className="text-sm text-soft">One kid per line: <code className="font-mono text-faint">First Last, age, weight, belt, gender</code>. Everything after the name is optional.</p>
          <textarea aria-label="Roster text" value={text} onChange={e => setText(e.target.value)}
            placeholder={'Mateo Rivera, 8, 62, grey, M\nOlivia Kim, 8, 60, grey/white, F'}
            className="h-40 w-full rounded-md border border-input bg-card p-2.5 font-mono text-sm text-foreground placeholder:text-faint outline-none focus-visible:border-transparent focus-visible:shadow-focus" />
          <div className="flex items-center gap-3">
            <Label htmlFor="paste-team">Put them on</Label>
            <Select value={teamId} onValueChange={setTeamId} items={teamItems}>
              <SelectTrigger id="paste-team" className="w-48"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                {teamItems.map(i => <SelectItem key={String(i.value)} value={i.value}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {parsed.errors.length > 0 && (
            <ul role="alert" className="grid gap-1 text-[13px] text-destructive">{parsed.errors.map(e => <li key={e}>{e}</li>)}</ul>
          )}
          {parsed.rows.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-[13px] text-faint">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left font-medium">Name</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Age</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Weight</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Belt</th>
                    <th className="px-2.5 py-1.5 text-left font-medium">Gender</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2.5 py-1.5">{r.firstName} {r.lastName}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums">{r.age ?? '-'}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums">{r.weightLbs ?? '-'}</td>
                      <td className="px-2.5 py-1.5">{beltLabel(r.belt ?? null)}</td>
                      <td className="px-2.5 py-1.5">{r.gender ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {add.error && <p role="alert" className="text-[13px] text-destructive">{add.error.message}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={add.isPending || parsed.rows.length === 0}>Add {parsed.rows.length} kids</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
