import type { ReactNode } from 'react'
import type { RosterCandidate } from '@/lib/types'
import { beltLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldHead, FieldRow } from '@/components/ui/field-set'

/**
 * 7.1's track set at the `default` 40px rung, shared by the two dialogs that list
 * WellnessLiving candidates so a rating sits in the same register in both.
 *
 * `ch` resolves against the element that consumes the track, so the grid carries the
 * mono face and the words inside it opt back into the sans face. The head is pinned to
 * the row's own `t2` for the same reason: at the head's `t1` the same formula resolves
 * 2.4px narrower and the register tick would stop landing where the digits end. The
 * labels take `t1` on themselves instead.
 */
const COLS = 'grid grid-cols-[var(--col-select)_var(--col-state)_minmax(0,1fr)_var(--col-num-s)_var(--col-num-m)] gap-x-3 font-mono t2'

export function CandidateHead({ valueLabel }: { valueLabel: string }) {
  return (
    <FieldHead className={COLS}>
      <span className="sr-only">Select</span>
      <span />
      <span className="t1 uppercase">Competitor</span>
      <span className="tick t1 text-right uppercase">Age</span>
      <span className="tick t1 text-right uppercase">{valueLabel}</span>
    </FieldHead>
  )
}

export function CandidateRow({ candidate, checked, onCheckedChange, meta }: {
  candidate: RosterCandidate
  checked: boolean
  onCheckedChange: (v: boolean) => void
  meta?: ReactNode
}) {
  const name = `${candidate.firstName} ${candidate.lastName}`
  return (
    <FieldRow className={cn(COLS, 'h-10')} data-selected={checked || undefined}>
      <Checkbox aria-label={`Select ${name}`} checked={checked} onCheckedChange={onCheckedChange} />
      <span aria-hidden />
      <span className="flex min-w-0 items-center gap-2 font-sans">
        <span title={name} className="truncate t3 text-gray-12">{name}</span>
        <span className="truncate t2 text-gray-10">{beltLabel(candidate.belt)}</span>
        {meta}
      </span>
      <span className={cn('fig fig-2 text-right', candidate.age === null ? 'text-attend' : 'text-gray-11')}>
        {candidate.age ?? '--'}
      </span>
      <span className={cn('fig fig-4 text-right', candidate.erp === null ? 'text-gray-9' : 'text-gray-12')}>
        {candidate.erp === null ? '--' : candidate.erp.toFixed(1)}
      </span>
    </FieldRow>
  )
}
