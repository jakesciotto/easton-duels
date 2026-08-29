import { useState } from 'react'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail, RulesetRow } from '@/lib/types'
import { RulesetDialog } from './RulesetDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export function RulesetsTab({ detail }: { detail: EventDetail }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RulesetRow | undefined>(undefined)
  const remove = useAdminMutation(detail.event.id, (id: number) => adminApi(`/api/rulesets/${id}`, { method: 'DELETE' }))
  const used = new Set(detail.matches.map(m => m.rulesetId))

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => { setEditing(undefined); setOpen(true) }}>New ruleset</Button>
        {remove.error && <p role="alert" className="text-[13px] text-destructive">{remove.error.message}</p>}
      </div>
      <RulesetDialog detail={detail} open={open} onOpenChange={setOpen} ruleset={editing} />
      <div className="grid gap-3 md:grid-cols-2">
        {detail.rulesets.map(r => (
          <Card key={r.id}>
            <CardContent className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.name}</span>
                <span className="font-mono text-[13px] tabular-nums text-faint">{Math.floor(r.defaultLengthSec / 60)}:{String(r.defaultLengthSec % 60).padStart(2, '0')}</span>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true) }}>Edit</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove.mutate(r.id)} disabled={used.has(r.id) || detail.rulesets.length === 1}>Delete</Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {r.actions.map(a => <Badge key={a.key}>{a.label} <span className="font-mono tabular-nums">{a.points >= 0 ? '+' : ''}{a.points}</span></Badge>)}
              </div>
              <div className="flex flex-wrap gap-1">
                {r.terminals.map(t => <Badge key={t.key} variant="done">{t.label}: {t.winType}</Badge>)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
