import { ApiError } from '@/lib/api'
import { CERTIFIED_REFUSAL_BODY, CERTIFIED_REFUSAL_TITLE, isCertifiedRefusal } from '@/lib/eventMode'
import { athleteName, winTypeLabel } from '@/lib/format'
import type { AthleteRow, MatchRow } from '@/lib/types'
import type { WinType } from '@shared/types'

export const SAME_PAIR_WINDOW_MS = 60_000
// A POST that never settles would otherwise leave Save disabled with a reload as
// the only recourse, and a reload mints a new entryId and reopens the duplicate
// window. The watchdog makes "no answer" a terminal outcome like any other.
export const SAVE_TIMEOUT_MS = 8_000
export const LEDGER_LIMIT = 200
export const SAVED_LABEL_MS = 900
export const CUE_MS = 600

export interface EntryDraft {
  entryId: string
  aId: string
  bId: string
  pointsA: string
  pointsB: string
  winner: 'a' | 'b' | null
  winType: WinType
  editingId: number | null
}

// One slot per intent, not one per event. A correction is a different job from the
// new entry the desk is still holding, so opening, saving or cancelling one can
// never reach the other's slot and delete a result that was typed and never sent.
const DRAFT_ROOT = 'duels:entry:'
const CORRECTION = ':match:'

export const draftKey = (eventId: number, editingId: number | null): string =>
  editingId === null ? `${DRAFT_ROOT}${eventId}` : `${DRAFT_ROOT}${eventId}${CORRECTION}${editingId}`

const isDraft = (v: unknown): v is EntryDraft => {
  if (!v || typeof v !== 'object') return false
  const d = v as Record<string, unknown>
  return typeof d.entryId === 'string' && d.entryId.length >= 8
    && typeof d.aId === 'string' && typeof d.bId === 'string'
    && typeof d.pointsA === 'string' && typeof d.pointsB === 'string'
    && (d.winner === 'a' || d.winner === 'b' || d.winner === null)
    && (d.winType === 'points' || d.winType === 'submission' || d.winType === 'decision')
    && (d.editingId === null || typeof d.editingId === 'number')
}

// Storage throws in Safari private mode rather than returning null, so every
// call site treats an unreadable store as an empty one. A payload whose editingId
// disagrees with its slot is discarded: it can only be a draft written by an older
// build that kept every intent in one slot.
export function loadDraft(eventId: number, editingId: number | null = null): EntryDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(eventId, editingId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isDraft(parsed) && parsed.editingId === editingId ? parsed : null
  } catch {
    return null
  }
}

export function saveDraft(eventId: number, draft: EntryDraft): void {
  try {
    sessionStorage.setItem(draftKey(eventId, draft.editingId), JSON.stringify(draft))
  } catch {
    // An entry that cannot be persisted still holds its id in memory.
  }
}

export function clearDraft(eventId: number, editingId: number | null = null): void {
  try {
    sessionStorage.removeItem(draftKey(eventId, editingId))
  } catch {
    // Nothing to recover from: the draft is already unreachable.
  }
}

// What a reload should put back on screen. The unsent new entry outranks a
// correction, because it is the one that becomes nothing if it is lost; a stranded
// correction is still offered when there is no new entry waiting, lowest match
// first so the choice does not depend on storage iteration order.
export function restoreDraft(eventId: number): EntryDraft | null {
  const created = loadDraft(eventId)
  if (created) return created
  const prefix = `${DRAFT_ROOT}${eventId}${CORRECTION}`
  const ids: number[] = []
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const id = Number(key.slice(prefix.length))
      if (Number.isInteger(id)) ids.push(id)
    }
  } catch {
    return null
  }
  for (const id of ids.sort((x, y) => x - y)) {
    const draft = loadDraft(eventId, id)
    if (draft) return draft
  }
  return null
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

/**
 * Everything about a draft that the server is told, so two attempts can be compared.
 *
 * 7.12 holds one entryId through every retry, and the server dedupes on it. That is
 * right for a plain resend and wrong for a corrected one: an operator who fixed a
 * number after a failure and pressed Save again had the ORIGINAL result replayed and
 * the corrected one reported. A retry that carries a different shape gets a new id,
 * but only when the failure it follows was one the server definitely refused.
 */
export function entryShape(d: EntryDraft): string {
  const points = (v: string) => String(v === '' ? 0 : Number(v))
  return [d.editingId ?? 'new', d.aId, d.bId, points(d.pointsA), points(d.pointsB), d.winner ?? '', d.winType].join('|')
}

/**
 * Whether the server is known to have stored nothing, which is the only condition under
 * which a corrected retry may carry a new entryId.
 *
 * A timeout, a dropped connection and a 500 all leave the write in doubt: the POST may
 * have landed and the answer may have been lost on the way back. Minting a new id there
 * inserts a second done match for the pair and the team wins twice, which is worse in
 * every case than the alternative, where the resend is deduped and the desk is told what
 * is on file. 408 and 429 are 4xx by number and doubt by meaning, so they are excluded
 * with the rest.
 */
export function serverRefused(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429
}

/**
 * The last time each pair was entered, read off the ledger the server already holds.
 *
 * The same-pair guard lived only in memory, so the reload that a failed save invites
 * reopened the window on the pair it was protecting: the desk could type the same result
 * twice with no question asked. The stored endedAt is the record of the first one.
 */
export function seedPairLog(matches: MatchRow[]): Record<string, number> {
  const log: Record<string, number> = {}
  for (const m of matches) {
    if (m.status !== 'done' || !m.endedAt) continue
    const at = Date.parse(m.endedAt)
    if (Number.isNaN(at)) continue
    const key = pairKey(m.athleteAId, m.athleteBId)
    if (log[key] === undefined || at > log[key]) log[key] = at
  }
  return log
}

// What the client reads off a save's response. Typed as what it checks rather than as
// the full match view, because a response that is missing a field is a case this has to
// survive rather than a case the compiler can rule out.
export interface EntrySide { athleteId?: number; name?: string; score?: number }
export interface EntryMatch {
  id?: number
  a?: EntrySide
  b?: EntrySide
  result?: { winnerAthleteId?: number; winType?: WinType } | null
}

export interface StoredOutcome {
  winnerAthleteId: number
  winType: WinType
  scores: Record<number, number>
  /** "Ava Park beat Noah Tran on points, 5 to 2", with no leading verb. */
  sentence: string
}

/**
 * 6.6: Save confirms from its own response. The sentence used to be built from the form,
 * which reports what was typed rather than what was stored, and a deduped resend stores
 * neither.
 */
export function storedOutcome(match: EntryMatch | null | undefined): StoredOutcome | null {
  const { a, b, result } = match ?? {}
  if (!a || !b || !result) return null
  const { winnerAthleteId, winType } = result
  if (typeof winnerAthleteId !== 'number' || !winType) return null
  if (typeof a.athleteId !== 'number' || typeof b.athleteId !== 'number') return null
  const aWon = winnerAthleteId === a.athleteId
  const won = aWon ? a : b
  const lost = aWon ? b : a
  return {
    winnerAthleteId,
    winType,
    scores: { [a.athleteId]: a.score ?? 0, [b.athleteId]: b.score ?? 0 },
    sentence: `${won.name ?? 'Unknown'} beat ${lost.name ?? 'Unknown'} ${winTypeLabel(winType)}, ${a.score ?? 0} to ${b.score ?? 0}`,
  }
}

/** Whether the result on file is the one this attempt sent. */
export function outcomeMatches(
  outcome: StoredOutcome,
  sent: { winnerAthleteId: number; winType: WinType; scores: Record<number, number> },
): boolean {
  if (outcome.winnerAthleteId !== sent.winnerAthleteId || outcome.winType !== sent.winType) return false
  return Object.entries(sent.scores).every(([id, points]) => outcome.scores[Number(id)] === points)
}

// A replay is not a failure, so it never wears the fault band. It does have to be read,
// because the result the desk just typed is not the result on file.
export function duplicateCopy(outcome: StoredOutcome | null): SaveErrorCopy {
  return {
    title: 'This entry was already saved',
    body: outcome === null
      ? 'The server had it already, so nothing was added. Check the ledger.'
      : `The result on file is ${outcome.sentence}. Edit that row in the ledger to change it.`,
  }
}

export function isRepeatPair(log: Record<string, number>, key: string, now: number): boolean {
  const at = log[key]
  return at !== undefined && now - at < SAME_PAIR_WINDOW_MS
}

export function teamWins(matches: MatchRow[], athletes: AthleteRow[]): Map<number, number> {
  const teamOf = new Map(athletes.map(a => [a.id, a.teamId]))
  const wins = new Map<number, number>()
  for (const m of matches) {
    if (m.status !== 'done' || m.winnerAthleteId === null) continue
    const teamId = teamOf.get(m.winnerAthleteId)
    if (teamId === null || teamId === undefined) continue
    wins.set(teamId, (wins.get(teamId) ?? 0) + 1)
  }
  return wins
}

export interface SaveErrorCopy { title: string; body: string }

// The banner a restored, never-sent NEW entry wears. A restored correction never
// gets this copy: see restoredBannerCopy below.
export const RESTORED_NEW_ENTRY: SaveErrorCopy = { title: 'This entry never sent', body: 'It was kept on this device. Check it, then press Save.' }

// R5: a correction can be stranded (a failed Save, then the desk moves on without
// pressing Cancel edit) and later restored on a fresh mount. It must never wear
// the same banner as an unsent new entry: the operator cannot tell "this was
// never sent" from "this was never sent, over a match someone else may have since
// corrected properly" without the match named, and would be inviting a stale
// resend over a good result.
export function restoredBannerCopy(draft: EntryDraft, matches: MatchRow[], athletes: AthleteRow[]): SaveErrorCopy {
  if (draft.editingId === null) return RESTORED_NEW_ENTRY
  const byId = new Map(athletes.map(a => [a.id, a]))
  const nameOf = (id: number) => { const a = byId.get(id); return a ? athleteName(a) : 'Unknown' }
  const m = matches.find(x => x.id === draft.editingId)
  const label = m ? `${nameOf(m.athleteAId)} vs ${nameOf(m.athleteBId)}` : `match ${draft.editingId}`
  return { title: `This correction to ${label} never sent`, body: 'It was kept on this device. Check it, then press Save.' }
}

// 6.9's done voice for a refused NEW result. It deliberately reads differently from the
// tab's own FINISHED_LINE: the tab is standing over an event that still takes corrections
// until somebody certifies it, and this is the server refusing the one thing a finished
// event does not take. Saying the tab's sentence here would tell the desk to retry.
export const EVENT_DONE: SaveErrorCopy = {
  title: 'This event is finished',
  body: 'No result can be entered now, and the results here are the record.',
}

// Certification is the harder refusal: a finished event still takes a correction (the
// server accepts one on a settled match), and a certified one takes nothing at all.
export const EVENT_CERTIFIED: SaveErrorCopy = {
  title: CERTIFIED_REFUSAL_TITLE,
  body: CERTIFIED_REFUSAL_BODY,
}

// 7.12: every failure states what happened and what to do next, mapped from the
// server's own codes. The unreachable-server case is the one gym wifi produces.
export function saveErrorCopy(error: unknown): SaveErrorCopy {
  if (!(error instanceof ApiError)) {
    return { title: 'Could not reach the server', body: 'Your entry is kept on this device. Press Save to try again when the connection returns.' }
  }
  if (error.status === 429) return { title: 'Too many attempts', body: 'Wait a minute, then press Save again.' }
  if (error.status === 401 || error.status === 403) return { title: 'The desk session expired', body: 'Enter the event PIN again, then press Save.' }
  if (error.status === 404) return { title: 'That match is no longer here', body: 'Reload the page, then enter the result again.' }
  if (error.status === 422) return { title: 'That result cannot be saved', body: error.message }
  if (error.code === 'sequence') return { title: 'Another device scored this mat first', body: 'The result on screen refreshes. Check it, then save again.' }
  // The server refuses every write once the event is finished, and it says which of the
  // two match_state refusals this is. Reopening a match cannot help with that one.
  if (isCertifiedRefusal(error)) return EVENT_CERTIFIED
  if (error.code === 'match_state' && /event is done/i.test(error.message)) return EVENT_DONE
  if (error.code === 'match_state') return { title: 'This match already ended', body: 'Reopen it from the Live tab to change the result.' }
  if (error.status >= 500) return { title: 'The server had a problem', body: 'Press Save to try again.' }
  return { title: 'That result was not saved', body: error.message }
}

// The ledger's own column, not a shared format: h:mm and nothing else, at most five
// characters inside the --col-num-l track, and an event never crosses noon and
// midnight both.
export function clockLabel(at: Date): string {
  const hour = at.getHours() % 12 || 12
  return `${hour}:${String(at.getMinutes()).padStart(2, '0')}`
}

// The server's endedAt is the record, so a reload and a second desk device read the
// same time for every row. The in-session stamp is the fallback for the one row this
// browser has just written and not yet refetched.
export function ledgerTime(endedAt: string | null | undefined, savedAt: number | undefined): Date | null {
  if (endedAt) {
    const at = new Date(endedAt)
    if (!Number.isNaN(at.getTime())) return at
  }
  return savedAt === undefined ? null : new Date(savedAt)
}
