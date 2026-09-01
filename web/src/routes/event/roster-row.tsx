import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { XIcon } from 'lucide-react'
import type { AthleteRow } from '@/lib/types'
import { athleteName, beltLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldRow } from '@/components/ui/field-set'
import { cn } from '@/lib/utils'

/**
 * The Ledger Grid at the two-line rung (2.7). The tracks are declared here and on
 * the column head, and both elements carry the mono face, because `ch` resolves
 * against the element's own font and the sans zero is a different width.
 */
export const ROSTER_COLS =
  'grid grid-cols-[var(--col-select)_var(--col-state)_minmax(0,1fr)_var(--col-num-s)_var(--col-num-m)_var(--col-act)] gap-x-3 px-3'

const CELL = 'fig t2 h-6 w-full rounded-md px-1.5 text-right transition-colors duration-120 ease-out'

type Source = AthleteRow['ageSource']

/**
 * A number the organizer reads far more often than they change, so it is text
 * that hovers rather than a permanently bordered box. Activation is a click, an
 * Enter, or any digit; Enter and blur commit; Escape reverts, which the bordered
 * box it replaces had no path to at all.
 */
function EditableCell({ label, value, source, onSave }: {
  label: string
  value: number | null
  source: Source
  onSave: (v: number | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const editing = draft !== null

  useEffect(() => {
    if (editing || !restoreFocus.current) return
    restoreFocus.current = false
    button.current?.focus()
  }, [editing])

  const close = () => {
    restoreFocus.current = true
    setDraft(null)
  }
  const commit = () => {
    if (draft === null) return
    const next = draft === '' ? null : Number(draft)
    close()
    if (next !== value && (next === null || Number.isFinite(next))) onSave(next)
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={label}
        inputMode="numeric"
        placeholder="--"
        value={draft}
        onChange={e => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
        }}
        className={cn(CELL, 'border-0 bg-gray-3 text-white outline-none placeholder:text-gray-9 focus-visible:shadow-focus')}
      />
    )
  }

  const estimated = value !== null && source === 'leaderboard'
  return (
    <button
      ref={button}
      type="button"
      aria-label={label}
      title={estimated ? 'Estimated from the leaderboard until it is typed over' : undefined}
      onClick={() => setDraft(value === null ? '' : String(value))}
      onKeyDown={e => {
        if (!/^[0-9]$/.test(e.key)) return
        e.preventDefault()
        setDraft(e.key)
      }}
      className={cn(
        CELL,
        'cursor-text hover:bg-gray-3 focus-visible:bg-gray-3 focus-visible:shadow-focus',
        value === null && 'text-attend',
        estimated && 'text-gray-10 underline decoration-gray-8 decoration-dotted underline-offset-2',
        value !== null && !estimated && 'text-white',
      )}
    >
      {value === null ? '--' : value}
    </button>
  )
}

export function RosterRow({ kid, selected, fault, onSelect, onPatch, onRemove, onDragStart }: {
  kid: AthleteRow
  selected: boolean
  fault: boolean
  onSelect: (v: boolean, range: boolean) => void
  onPatch: (body: Partial<AthleteRow>) => void
  onRemove: () => void
  onDragStart: (e: ReactPointerEvent, id: number) => void
}) {
  const name = athleteName(kid)
  const range = useRef(false)
  const state = fault ? 'fault' : kid.age === null || kid.weightLbs === null ? 'attend' : 'ok'
  const meta = [beltLabel(kid.belt), kid.gender, kid.erp === null ? 'unrated' : `ERP ${kid.erp.toFixed(1)}`]
    .filter(Boolean)
    .join(' · ')

  return (
    <FieldRow
      role="listitem"
      data-density="two-line"
      data-state={state}
      data-selected={selected}
      onPointerDownCapture={e => { range.current = e.shiftKey }}
      onClickCapture={e => { range.current = e.shiftKey }}
      onPointerDown={e => {
        if ((e.target as HTMLElement).closest('button, input, a')) return
        onDragStart(e, kid.id)
      }}
      className={cn(ROSTER_COLS, 'group/row h-14 touch-pan-y py-2 font-mono t2 focus-within:bg-accent')}
    >
      <Checkbox
        aria-label={`Select ${name}`}
        checked={selected}
        onCheckedChange={checked => onSelect(checked, range.current)}
      />
      <span
        aria-hidden
        className={cn(
          'h-9 w-full rounded-[2px]',
          state === 'attend' && 'bg-attend',
          state === 'fault' && 'bg-fault',
        )}
      />
      <span className="min-w-0 font-sans">
        <span className="block truncate t3 font-medium! text-white" title={name}>{name}</span>
        <span className="block truncate t2 font-normal! leading-4! text-gray-10">{meta}</span>
      </span>
      <EditableCell
        label={`Age for ${name}`}
        value={kid.age}
        source={kid.ageSource}
        onSave={age => onPatch({ age })}
      />
      <EditableCell
        label={`Weight for ${name}`}
        value={kid.weightLbs}
        source={kid.weightSource}
        onSave={weightLbs => onPatch({ weightLbs })}
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="text-gray-9 hover:text-fault group-hover/row:text-fault group-focus-within/row:text-fault"
      >
        <XIcon />
      </Button>
    </FieldRow>
  )
}
