import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { IdCardIcon, XIcon } from 'lucide-react'
import type { AthleteRow, RosterCandidate } from '@/lib/types'
import { athleteName, beltLabel, genderLabel } from '@/lib/format'
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
  'grid grid-cols-[var(--col-select)_var(--col-state)_minmax(0,1fr)_var(--col-num-s)_var(--col-num-m)_var(--col-act)_var(--col-act)] gap-x-3 px-3'

/**
 * The same tracks plus one fixed 56px cell for the Link control, which an event with a
 * WellnessLiving pool carries on every row and on the head.
 *
 * The width is fixed rather than `auto` on purpose. The head is a separate grid from the
 * rows, so an intrinsic track resolves to 0 on the head and to the button's width on the
 * rows, and the numeric columns under it would then stop lining up with their labels.
 */
const ROSTER_COLS_LINK =
  'grid grid-cols-[var(--col-select)_var(--col-state)_minmax(0,1fr)_var(--col-num-s)_var(--col-num-m)_56px_var(--col-act)_var(--col-act)] gap-x-3 px-3'

export function rosterCols(withLink: boolean): string {
  return withLink ? ROSTER_COLS_LINK : ROSTER_COLS
}

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
      // An aria-label REPLACES the name computed from the contents, so labelling the
      // column alone discards the one thing the cell exists to say. The value, and an
      // explicit word for the missing case, belong in the name: finding the
      // competitors with no weight is the task this screen is for.
      aria-label={`${label}, ${value === null ? 'missing' : value}`}
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

export const NOT_IN_WL = 'Not in WellnessLiving'

/** 7.3. The near match the sync could not settle, as the row says it. */
export function looksLikeLine(candidate: { firstName: string; lastName: string; wlLocation: string }): string {
  return `Looks like ${athleteName(candidate)}, ${candidate.wlLocation}`
}

export function RosterRow({ kid, selected, fault, inMatch, candidateCount, suggestion, onSelect, onPatch, onRemove, onLink, onConfirm, onDismiss, onProfile, onDragStart }: {
  kid: AthleteRow
  selected: boolean
  fault: boolean
  /** The server refuses a delete for anyone sitting in a match, so the row refuses first. */
  inMatch: boolean
  /** The pool this row could be linked to. With none there is nothing to say and nothing to press. */
  candidateCount: number
  /**
   * The candidate `suggestedWlUid` names, once the pool has been read. The row can act on
   * the stored uid without it, so the controls stand from the first render and only the
   * words arrive late.
   */
  suggestion: RosterCandidate | undefined
  onSelect: (v: boolean, range: boolean) => void
  onPatch: (body: Partial<AthleteRow>) => void
  onRemove: () => void
  onLink: () => void
  onConfirm: (wlUid: string) => void
  onDismiss: (wlUid: string) => void
  onProfile: () => void
  onDragStart: (e: ReactPointerEvent, id: number) => void
}) {
  const withLink = candidateCount > 0
  const suggested = kid.suggestedWlUid
  const unlinked = withLink && kid.wlUid === null && suggested === null
  const name = athleteName(kid)
  const range = useRef(false)
  const state = fault ? 'fault' : kid.age === null || kid.weightLbs === null ? 'attend' : 'ok'
  // The refusal is printed on the row's own meta line, because a disabled control
  // takes no pointer events and so can never show a title.
  const meta = [
    beltLabel(kid.belt),
    genderLabel(kid.gender),
    kid.erp === null ? 'unrated' : `ERP ${kid.erp.toFixed(1)}`,
    inMatch ? 'In a match' : null,
    unlinked ? NOT_IN_WL : null,
  ]
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
      className={cn(
        rosterCols(withLink),
        'group/row touch-pan-y py-2 font-mono t2 focus-within:bg-accent',
        // A row waiting on a person carries a control line of its own. Two sm buttons need
        // about 168px, and the three-up column at 1280 has 394px against 246px of fixed
        // tracks, so they cannot sit beside the numbers without emptying the name.
        suggested === null ? 'h-14' : 'min-h-14 gap-y-2',
      )}
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
        <span className="block truncate t2 font-normal! leading-4! text-gray-10">
          {meta}
          {suggested !== null && suggestion !== undefined && (
            <span className="text-gray-11">{meta === '' ? '' : ' · '}{looksLikeLine(suggestion)}</span>
          )}
        </span>
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
      {withLink && (unlinked
        ? <Button variant="ghost" size="sm" aria-label={`Link ${name}`} onClick={onLink} className="w-full px-0 font-sans">Link</Button>
        : <span />)}
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Profile for ${name}`}
        onClick={onProfile}
        className="text-gray-9 group-hover/row:text-gray-11 group-focus-within/row:text-gray-11"
      >
        <IdCardIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={inMatch ? `Remove ${name}, already in a match` : `Remove ${name}`}
        disabled={inMatch}
        onClick={onRemove}
        className="text-gray-9 hover:text-fault group-hover/row:text-fault group-focus-within/row:text-fault"
      >
        <XIcon />
      </Button>
      {suggested !== null && (
        <span className="col-span-full flex items-center gap-2 font-sans">
          <Button variant="ghost" size="sm" aria-label={`Confirm ${name}`} onClick={() => onConfirm(suggested)}>Confirm</Button>
          <Button variant="ghost" size="sm" aria-label={`Not them, ${name}`} onClick={() => onDismiss(suggested)}>Not them</Button>
        </span>
      )}
    </FieldRow>
  )
}
