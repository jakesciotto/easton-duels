import { useState } from 'react'
import { formatClock } from '@shared/clock'
import type { RulesetAction, RulesetTerminal } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail, RulesetRow } from '@/lib/types'
import { RulesetDialog } from './RulesetDialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FieldSet, FieldHead, FieldRow } from '@/components/ui/field-set'

const ROW = 'flex h-8 items-center gap-3'

// 6.7: "A ruleset card previews as the scorer's actual three column action grid at quarter
// scale, so what the coach will see is what the organizer edits." Quarter of 7.15/6.16's
// 64px cell and 12px gap; the moat (32px + a rule) is quartered the same way, at 8px.
function ActionGridPreview({ actions, terminals }: { actions: RulesetAction[]; terminals: RulesetTerminal[] }) {
  return (
    <div aria-hidden className="px-3 py-3">
      <div className="grid grid-cols-3 gap-[3px]">
        {actions.map(a => <span key={a.key} className="h-4 rounded-sm bg-gray-5" />)}
      </div>
      {terminals.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-[3px] border-t border-gray-7 pt-2">
          {terminals.map(t => <span key={t.key} className="h-4 rounded-sm border border-gray-7" />)}
        </div>
      )}
    </div>
  )
}

function RulesetCard({ ruleset, used, locked, onEdit, onDelete }: {
  ruleset: RulesetRow
  used: boolean
  locked: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <FieldSet data-frame="card">
      <FieldHead className="flex h-8 items-center gap-2">
        <span className="min-w-0 flex-1 truncate t3 font-medium text-gray-12">{ruleset.name}</span>
        <span className="fig text-gray-10">{formatClock(ruleset.defaultLengthSec * 1000)}</span>
        <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
        <Button size="sm" variant="destructive" onClick={onDelete} disabled={used || locked}>Delete</Button>
      </FieldHead>
      {/* 6.7: action points read as a column of values on a fixed numeric track, not badges --
          the shape an organizer scans to find the one value that is wrong. */}
      {ruleset.actions.map(a => (
        <FieldRow key={a.key} className={ROW}>
          <span className="min-w-0 flex-1 truncate t3 text-gray-12">{a.label}</span>
          <span className="fig text-right" style={{ minWidth: 'var(--col-num-s)' }}>{a.points >= 0 ? '+' : ''}{a.points}</span>
        </FieldRow>
      ))}
      {ruleset.terminals.map(t => (
        <FieldRow key={t.key} className={ROW}>
          <span className="min-w-0 flex-1 truncate t3 text-gray-12">{t.label}</span>
          <span className="t3 text-right text-gray-10" style={{ minWidth: 'var(--col-num-s)' }}>{t.winType}</span>
        </FieldRow>
      ))}
      <ActionGridPreview actions={ruleset.actions} terminals={ruleset.terminals} />
    </FieldSet>
  )
}

export function RulesetsTab({ detail }: { detail: EventDetail }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RulesetRow | undefined>(undefined)
  const remove = useAdminMutation(detail.event.id, (id: number) => adminApi(`/api/rulesets/${id}`, { method: 'DELETE' }))
  const used = new Set(detail.matches.map(m => m.rulesetId))

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => { setEditing(undefined); setOpen(true) }}>New ruleset</Button>
        {remove.error && (
          <Alert className="w-fit">
            <AlertDescription>{remove.error.message}</AlertDescription>
          </Alert>
        )}
      </div>
      <RulesetDialog detail={detail} open={open} onOpenChange={setOpen} ruleset={editing} />
      <div className="grid items-start gap-4 md:grid-cols-2">
        {detail.rulesets.map(r => (
          <RulesetCard
            key={r.id}
            ruleset={r}
            used={used.has(r.id)}
            locked={detail.rulesets.length === 1}
            onEdit={() => { setEditing(r); setOpen(true) }}
            onDelete={() => remove.mutate(r.id)}
          />
        ))}
      </div>
    </div>
  )
}
