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

/**
 * A tab holds one mat and scores one match at a time, so every key but the current match's
 * describes a bout that is finished. Nothing ever removed them: a tablet that ran a mat all
 * afternoon kept a ledger for every match it had scored, none of which any control can read,
 * against a quota it shares with everything else this origin stores. The current match's key
 * is the one that has to survive, because restoring it across a reload is the whole reason
 * this shelf exists.
 */
export function pruneLedgers(keep: number): void {
  try {
    const stale: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k !== null && k.startsWith(PREFIX) && k !== key(keep)) stale.push(k)
    }
    for (const k of stale) sessionStorage.removeItem(k)
  } catch { /* storage blocked */ }
}
