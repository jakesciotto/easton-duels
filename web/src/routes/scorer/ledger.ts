import type { LocalAction } from './actions'

/**
 * The local action ledger, kept across a reload.
 *
 * Undo and both minus buttons refuse whenever this tablet cannot name the newest event, and
 * the ledger lived only in component state, so a tablet that reloaded mid match refused to
 * take back the tap it had just made: the reason printed was "The newest action came from
 * elsewhere", which was not true and left the mat with no correction at all. Session storage
 * is the right shelf for it -- it is scoped to the tab that holds the mat, and it goes away
 * when that tab does, which is exactly the lifetime of a binding to one mat.
 *
 * The ledger is a memory of what THIS tablet did, never a source of score. Anything above
 * the seq the server reports describes an event that was taken away while the tab was gone,
 * so it is discarded on restore rather than offered as something to undo.
 */
const PREFIX = 'duels:scorer-log:'

/** A few, not all: the controls only ever read the newest entry, and storage is not a log. */
export const LEDGER_CAP = 12

const key = (matchId: number) => `${PREFIX}${matchId}`

function isAction(value: unknown): value is LocalAction {
  if (typeof value !== 'object' || value === null) return false
  const a = value as Partial<LocalAction>
  if (typeof a.seq !== 'number' || typeof a.at !== 'string') return false
  return a.kind === 'score' || a.kind === 'clock' || a.kind === 'extend'
}

export function loadLedger(matchId: number, lastSeq: number): LocalAction[] {
  try {
    const raw = sessionStorage.getItem(key(matchId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isAction).filter(a => a.seq <= lastSeq)
  } catch {
    return []
  }
}

export function saveLedger(matchId: number, actions: LocalAction[]): void {
  try {
    sessionStorage.setItem(key(matchId), JSON.stringify(actions.slice(-LEDGER_CAP)))
  } catch { /* storage blocked or full */ }
}
