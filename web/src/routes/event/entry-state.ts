import { ApiError } from '@/lib/api'
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
