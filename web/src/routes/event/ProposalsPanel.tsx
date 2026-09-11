import { useState } from 'react'
import { adminApi, useAdminMutation, useProposals } from '@/lib/queries'
import { CERTIFIED_REFUSAL, writeErrorMessage } from '@/lib/eventMode'
import type { EventDetail, Proposal, ProposalSide, TeamRow } from '@/lib/types'
import { beltLabel } from '@/lib/format'
import { KidPickerDialog } from './KidPickerDialog'
import { RegenerateConfirmDialog } from './RegenerateConfirmDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldHead, FieldRow, FieldSet } from '@/components/ui/field-set'
import { TeamPlate } from '@/components/TeamPlate'

/** Two competitors and the sentence between them, with the three actions at the right. */
const PROPOSAL_COLS = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3'

// Which slot a swap is filling, and the two facts the picker needs: the team the kid
// staying in the pairing is on, and who is in the slot now.
interface Swap { proposalId: number; side: 'a' | 'b'; exclude: number; held: number }

interface SwapResult { proposal: Proposal; removed: number[]; warnings: string[] }

/** What a swap left behind on one row: what the server warned about, and what it deleted. */
interface RowNote { warnings: string[]; removed: number }

export const sideName = (s: ProposalSide) => `${s.firstName} ${s.lastName}`.trim()
export const proposalLabel = (p: Proposal) => `${sideName(p.a)} versus ${sideName(p.b)}`

// A kid sits in at most one proposal, so a swap frees one draft at most. The plural is
// carried anyway because the server answers a list.
export function removalNotice(removed: number): string {
  return removed === 1
    ? 'One other proposal was removed to free this competitor.'
    : `${removed} other proposals were removed to free this competitor.`
}

export function proposedLine(count: number): string {
  if (count === 0) return 'Nothing left to pair.'
  return `${count} ${count === 1 ? 'proposal' : 'proposals'} ready.`
}

export function confirmedLine(created: number): string {
  return `${created} ${created === 1 ? 'match' : 'matches'} confirmed.`
}

/**
 * 7.1: the whole side is the swap control rather than a fourth button in the row's
 * cluster. One Swap button cannot say which of the two competitors it is replacing, and
 * the organizer is already pointing at the one they want changed.
 */
function SideLine({ side, team, disabled, onSwap }: {
  side: ProposalSide
  team: TeamRow | undefined
  disabled: boolean
  onSwap: () => void
}) {
  const name = sideName(side)
  const meta = [side.age === null ? '--' : `${side.age}`, side.weightClass ?? '--', beltLabel(side.belt)].join(' · ')
  return (
    <button
      type="button"
      aria-label={`Swap ${name}, ${team?.name ?? 'no team'}`}
      title={disabled ? CERTIFIED_REFUSAL : 'Swap'}
      disabled={disabled}
      onClick={onSwap}
      className="-mx-2 grid min-w-0 gap-1 rounded-md px-2 py-1 text-left outline-none transition-colors duration-150 ease-standard hover:bg-gray-3 focus-visible:shadow-focus active:bg-gray-4 disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex min-w-0 items-center gap-2">
        {team && <TeamPlate color={team.color} name={team.name} size="inline" showName={false} />}
        <span className="truncate t3">{name}</span>
      </span>
      <span className="truncate t2 text-gray-10">{meta}</span>
    </button>
  )
}

/**
 * Spec 6's draft field, above the running order on the Matches tab and inside the setup
 * step. Nothing here is running or scheduled: a proposal is a suggestion the organizer
 * confirms, swaps, removes, or replaces by proposing again.
 */
export function ProposalsPanel({ detail, certified }: { detail: EventDetail; certified: boolean }) {
  const eventId = detail.event.id
  const q = useProposals(eventId)
  const proposals = q.data ?? []
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<number, RowNote>>({})
  const [swapping, setSwapping] = useState<Swap | null>(null)

  const propose = useAdminMutation(eventId, () => adminApi<Proposal[]>(`/api/events/${eventId}/proposals`, { method: 'POST' }), { proposals: true })
  const confirm = useAdminMutation(eventId, (id: number) => adminApi(`/api/proposals/${id}/confirm`, { method: 'POST' }), { proposals: true })
  const confirmAll = useAdminMutation(eventId, () => adminApi<{ created: number }>(`/api/events/${eventId}/proposals/confirm-all`, { method: 'POST' }), { proposals: true })
  const swap = useAdminMutation(eventId, (v: { id: number; body: Record<string, number> }) =>
    adminApi<SwapResult>(`/api/proposals/${v.id}`, { method: 'PATCH', body: v.body }), { proposals: true })
  const remove = useAdminMutation(eventId, (id: number) => adminApi(`/api/proposals/${id}`, { method: 'DELETE' }), { proposals: true })

  const teams = new Map(detail.teams.map(t => [t.id, t]))
  const has = proposals.length > 0

  const closeConfirm = () => {
    setConfirmOpen(false)
    propose.reset()
  }
  const runPropose = () => {
    propose.mutate(undefined, {
      onSuccess: rows => {
        setSummary(proposedLine(rows.length))
        setNotes({})
        closeConfirm()
      },
    })
  }
  const onProposeClick = () => {
    setSummary(null)
    if (has) { setConfirmOpen(true); return }
    runPropose()
  }
  const onConfirmAll = () => {
    setSummary(null)
    confirmAll.mutate(undefined, { onSuccess: r => setSummary(confirmedLine(r.created)) })
  }
  const onPicked = (athleteId: number) => {
    if (!swapping) return
    const { proposalId, side } = swapping
    setSummary(null)
    swap.mutate(
      { id: proposalId, body: side === 'a' ? { athleteAId: athleteId } : { athleteBId: athleteId } },
      { onSuccess: r => setNotes(n => ({ ...n, [proposalId]: { warnings: r.warnings, removed: r.removed.length } })) },
    )
    setSwapping(null)
  }

  // A react-query mutation holds its error until that same mutation runs again, so the
  // newest failure has to win by the moment it started or the banner names the wrong
  // action. While the confirm dialog is open a failed propose belongs inside it.
  const failure = [
    confirmOpen || !propose.error ? null : { title: 'The proposals did not come back', error: propose.error, at: propose.submittedAt },
    confirm.error ? { title: 'That match was not confirmed', error: confirm.error, at: confirm.submittedAt } : null,
    confirmAll.error ? { title: 'The proposals were not confirmed', error: confirmAll.error, at: confirmAll.submittedAt } : null,
    swap.error ? { title: 'The swap did not save', error: swap.error, at: swap.submittedAt } : null,
    remove.error ? { title: 'That proposal was not removed', error: remove.error, at: remove.submittedAt } : null,
  ].filter((f): f is { title: string; error: Error; at: number } => f !== null)
    .sort((x, y) => y.at - x.at)[0] ?? null

  return (
    <section aria-label="Proposals" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="t4">Proposals</h3>
        <Button size="sm" disabled={certified || propose.isPending} onClick={onProposeClick}>
          {has ? 'Propose more' : 'Propose matches'}
        </Button>
        <Button size="sm" variant="secondary" disabled={certified || !has || confirmAll.isPending} onClick={onConfirmAll}>
          Confirm all
        </Button>
        {/* 6.8: the reason a control is dead is printed once, beside the controls it
            kills, rather than waiting for somebody to press one and read a banner. */}
        {certified && <span className="t2 text-gray-10">{CERTIFIED_REFUSAL}</span>}
        {/* 7.12: one polite region, in the DOM and empty from the first render. */}
        <span aria-live="polite" className="t2 text-gray-10">{summary ?? ''}</span>
      </div>

      {q.error && (
        <Alert>
          <AlertTitle>The proposals did not load</AlertTitle>
          <AlertDescription>{q.error.message}</AlertDescription>
        </Alert>
      )}
      {failure && (
        <Alert>
          <AlertTitle>{failure.title}</AlertTitle>
          <AlertDescription>{writeErrorMessage(failure.error)}</AlertDescription>
        </Alert>
      )}

      <FieldSet>
        <FieldHead className={PROPOSAL_COLS}>
          <span className="font-sans">Competitor</span>
          <span className="font-sans">Why</span>
          <span className="font-sans">Competitor</span>
          <span className="sr-only">Actions</span>
        </FieldHead>
        {!has
          ? q.isLoading ? null : <EmptyState message="No proposals yet." />
          : (
            <div role="list">
              {proposals.map(p => {
                const note = notes[p.id]
                const label = proposalLabel(p)
                return (
                  <FieldRow key={p.id} role="listitem" className="py-2">
                    <div className={PROPOSAL_COLS}>
                      <SideLine
                        side={p.a} team={teams.get(p.a.teamId)} disabled={certified}
                        onSwap={() => setSwapping({ proposalId: p.id, side: 'a', exclude: p.b.teamId, held: p.a.athleteId })}
                      />
                      <span className="truncate t2 text-gray-10" title={p.why}>{p.why}</span>
                      <SideLine
                        side={p.b} team={teams.get(p.b.teamId)} disabled={certified}
                        onSwap={() => setSwapping({ proposalId: p.id, side: 'b', exclude: p.a.teamId, held: p.b.athleteId })}
                      />
                      <span className="flex items-center gap-2">
                        <Button
                          size="sm" aria-label={`Confirm ${label}`}
                          title={certified ? CERTIFIED_REFUSAL : undefined}
                          disabled={certified || confirm.isPending}
                          onClick={() => { setSummary(null); confirm.mutate(p.id) }}
                        >
                          Confirm
                        </Button>
                        {/* 7.7: a destructive control never sits flush against the row's
                            most repeated one. */}
                        <Button
                          size="sm" variant="destructive" className="ml-4" aria-label={`Remove ${label}`}
                          title={certified ? CERTIFIED_REFUSAL : undefined}
                          disabled={certified || remove.isPending}
                          onClick={() => { setSummary(null); remove.mutate(p.id) }}
                        >
                          Remove
                        </Button>
                      </span>
                    </div>
                    {note && (note.warnings.length > 0 || note.removed > 0) && (
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        {note.warnings.map(w => <span key={w} className="t2 text-attend">{w}</span>)}
                        {note.removed > 0 && <span className="t2 text-gray-10">{removalNotice(note.removed)}</span>}
                      </div>
                    )}
                  </FieldRow>
                )
              })}
            </div>
          )}
      </FieldSet>

      <RegenerateConfirmDialog
        open={confirmOpen}
        count={proposals.length}
        pending={propose.isPending}
        error={propose.error}
        onOpenChange={o => { if (o) setConfirmOpen(true); else closeConfirm() }}
        onConfirm={runPropose}
      />
      <KidPickerDialog
        detail={detail}
        exclude={swapping?.exclude ?? null}
        held={swapping?.held ?? null}
        open={swapping !== null}
        onOpenChange={o => { if (!o) setSwapping(null) }}
        onPick={onPicked}
      />
    </section>
  )
}
