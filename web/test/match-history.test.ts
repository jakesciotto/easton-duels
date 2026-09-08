import { describe, it, expect } from 'vitest'
import type { AuditEntry, AuditAction, AuditDetail } from '@shared/types'
import {
  actorWord, eventHistorySource, historyRows, historyTime, matchHistorySource, type HistoryContext,
} from '@/routes/event/match-history'
import type { EventDetail } from '@/lib/types'
import { sampleMatch } from './fakes'

// Built from a local Date so the printed clock is the same wherever the suite runs.
const at = (h: number, m: number, s: number) => new Date(2026, 9, 3, h, m, s).toISOString()

let nextId = 1
function row(action: AuditAction, detail: AuditDetail = {}, over: Partial<AuditEntry> = {}): AuditEntry {
  return { id: nextId++, at: at(15, 41, 2), actor: 'mat:2', action, detail, ...over }
}

const ctx: HistoryContext = {
  nameOf: id => (id === 100 ? 'Mateo Rivera' : id === 200 ? 'Olivia Kim' : 'Unknown'),
  athleteAId: 100,
  athleteBId: 200,
  actions: [
    { key: 'takedown', label: 'Takedown', points: 2 },
    { key: 'mount', label: 'Mount', points: 4 },
    { key: 'penalty', label: 'Penalty', points: -1 },
  ],
  terminals: [{ key: 'submission', label: 'Submission', winType: 'submission' }],
}

const outcome = { pointsA: 2, pointsB: 0, winnerAthleteId: 200, winType: 'submission' }

describe('historyTime', () => {
  it('prints h:mm:ss on the twelve hour clock', () => {
    expect(historyTime(at(15, 41, 2))).toBe('3:41:02')
    expect(historyTime(at(0, 5, 9))).toBe('12:05:09')
  })

  it('prints nothing for a time it cannot read', () => {
    expect(historyTime('not a time')).toBe('')
  })
})

describe('actorWord', () => {
  it('says a mat as a place and every other actor as itself', () => {
    expect(actorWord('mat:2')).toBe('mat 2')
    expect(actorWord('desk')).toBe('desk')
    expect(actorWord('admin')).toBe('admin')
    expect(actorWord('system')).toBe('system')
  })
})

describe('historyRows', () => {
  it('renders a scored point with its label, its value and the score after it', () => {
    const [line] = historyRows([row('score', { seq: 1, athleteId: 100, actionKey: 'takedown' })], ctx)
    expect(line.what).toBe('Takedown +2 Mateo Rivera')
    expect(line.detail).toBe('Score 2 to 0')
    expect(line.who).toBe('mat 2')
    expect(line.fromMat).toBe(true)
  })

  it('keeps the sign on an action that takes a point away', () => {
    const [line] = historyRows([row('score', { seq: 1, athleteId: 200, actionKey: 'penalty' })], ctx)
    expect(line.what).toBe('Penalty -1 Olivia Kim')
    expect(line.detail).toBe('Score 0 to -1')
  })

  it('runs the score forward across several points', () => {
    const rows = historyRows([
      row('score', { seq: 1, athleteId: 100, actionKey: 'takedown' }),
      row('score', { seq: 2, athleteId: 200, actionKey: 'mount' }),
    ], ctx)
    expect(rows.map(r => r.detail)).toEqual(['Score 2 to 0', 'Score 2 to 4'])
  })

  it('names the clock, the pause and the time added', () => {
    const rows = historyRows([
      row('clock_start', { seq: 1 }),
      row('clock_pause', { seq: 2 }),
      row('clock_extend', { seq: 3, addMs: 60_000 }),
    ], ctx)
    expect(rows.map(r => r.what)).toEqual(['Clock started', 'Clock stopped', 'Time added'])
    expect(rows[2].detail).toBe('Added 1:00')
  })

  it('names a terminal with the competitor it was called on', () => {
    const [line] = historyRows([row('terminal', { seq: 1, athleteId: 200, actionKey: 'submission' })], ctx)
    expect(line.what).toBe('Submission, Olivia Kim')
    expect(line.detail).toBeNull()
  })

  it('reads the end as a result sentence carrying the score it ended on', () => {
    const rows = historyRows([
      row('score', { seq: 1, athleteId: 100, actionKey: 'takedown' }),
      row('end', { seq: 2, winnerAthleteId: 200, winType: 'submission' }),
    ], ctx)
    expect(rows[1].what).toBe('Match ended')
    expect(rows[1].detail).toBe('Olivia Kim beat Mateo Rivera by submission, 2 to 0')
  })

  it('reads a desk entry as a result, and says when the desk added the match too', () => {
    const rows = historyRows([
      row('entry', outcome, { actor: 'desk' }),
      row('entry', { ...outcome, created: true }, { actor: 'desk' }),
    ], ctx)
    expect(rows[0].what).toBe('Result entered')
    expect(rows[0].detail).toBe('Olivia Kim beat Mateo Rivera by submission, 2 to 0')
    expect(rows[0].who).toBe('desk')
    expect(rows[0].fromMat).toBe(false)
    expect(rows[1].what).toBe('Match added and result entered')
  })

  it('prints a correction as after, before and the reason typed with it', () => {
    const [line] = historyRows([row('correction', {
      before: { pointsA: 2, pointsB: 0, winnerAthleteId: 200, winType: 'points' },
      after: { pointsA: 2, pointsB: 0, winnerAthleteId: 200, winType: 'submission' },
      reason: 'referee called the tap',
    }, { actor: 'admin' })], ctx)
    expect(line.what).toBe('Result edited')
    expect(line.detail).toBe(
      'Olivia Kim by submission, 2 to 0, was Olivia Kim on points, 2 to 0. Reason: referee called the tap',
    )
  })

  it('leaves the reason off a correction that carried none', () => {
    const [line] = historyRows([row('correction', {
      before: { pointsA: 1, pointsB: 0, winnerAthleteId: 100, winType: 'points' },
      after: { pointsA: 3, pointsB: 0, winnerAthleteId: 100, winType: 'points' },
    })], ctx)
    expect(line.detail).toBe('Mateo Rivera on points, 3 to 0, was Mateo Rivera on points, 1 to 0.')
  })

  it('carries the reason on an unlock', () => {
    const [line] = historyRows([row('uncertify', { reason: 'mat 2 typed the wrong winner' }, { actor: 'admin' })], ctx)
    expect(line.what).toBe('Results unlocked')
    expect(line.detail).toBe('Reason: mat 2 typed the wrong winner')
  })

  it('names the mat a match was called onto', () => {
    const [line] = historyRows([row('advance', { matId: 4, matNumber: 2 }, { actor: 'admin' })], ctx)
    expect(line.what).toBe('Called onto mat 2')
  })

  it('reads an action it has no verb for as English rather than as a column', () => {
    const [line] = historyRows([row('roster_sync' as AuditAction, { added: 3 }, { actor: 'admin' })], ctx)
    expect(line.what).toBe('Roster imported')
  })

  describe('undo', () => {
    it('keeps the undone action in the list and prints the undo beneath it', () => {
      const rows = historyRows([
        row('score', { seq: 1, athleteId: 100, actionKey: 'takedown' }),
        row('score', { seq: 2, athleteId: 100, actionKey: 'mount' }, { at: at(15, 42, 10) }),
        row('undo', { seq: 2, type: 'score', points: 4 }, { at: at(15, 42, 14) }),
      ], ctx)
      expect(rows).toHaveLength(2)
      expect(rows[1].what).toBe('Mount +4 Mateo Rivera')
      expect(rows[1].undone).toBe('Undone 3:42:14 by mat 2')
    })

    it('takes the undone points back out of every score printed after it', () => {
      const rows = historyRows([
        row('score', { seq: 1, athleteId: 100, actionKey: 'mount' }),
        row('undo', { seq: 1, type: 'score', points: 4 }),
        row('score', { seq: 1, athleteId: 100, actionKey: 'takedown' }),
      ], ctx)
      expect(rows[0].detail).toBeNull()
      expect(rows[0].undone).not.toBeNull()
      expect(rows[1].detail).toBe('Score 2 to 0')
    })

    /**
     * Undo frees the sequence number it deletes and the next write takes it, so a log can
     * hold two rows at seq 3 with only the first undone. Keying a map on the seq marks the
     * wrong one; the pairing is last in, first out, like the server's own delete.
     */
    it('pairs with the most recent row at that sequence, not the first', () => {
      const rows = historyRows([
        row('score', { seq: 3, athleteId: 100, actionKey: 'takedown' }),
        row('undo', { seq: 3, type: 'score' }, { at: at(15, 45, 0) }),
        row('score', { seq: 3, athleteId: 200, actionKey: 'mount' }),
      ], ctx)
      expect(rows[0].undone).toBe('Undone 3:45:00 by mat 2')
      expect(rows[1].undone).toBeNull()
      expect(rows[1].detail).toBe('Score 0 to 4')
    })

    it('renders an undo whose target is not in the window as its own row', () => {
      const rows = historyRows([row('undo', { seq: 900, type: 'score' })], ctx)
      expect(rows).toHaveLength(1)
      expect(rows[0].what).toBe('An action was taken back')
    })

    it('names whoever pressed undo, not whoever wrote the row', () => {
      const rows = historyRows([
        row('score', { seq: 1, athleteId: 100, actionKey: 'takedown' }),
        row('undo', { seq: 1, type: 'score' }, { actor: 'admin', at: at(16, 0, 5) }),
      ], ctx)
      expect(rows[0].undone).toBe('Undone 4:00:05 by admin')
    })
  })

  // The event sheet lists rows from every match at once, so one accumulator across a whole
  // afternoon would be a number nothing in the room agrees with.
  it('prints no running score when it does not know the two sides', () => {
    const eventCtx: HistoryContext = { ...ctx, athleteAId: null, athleteBId: null }
    const rows = historyRows([
      row('score', { seq: 1, athleteId: 100, actionKey: 'takedown' }),
      row('end', { seq: 2, winnerAthleteId: 200, winType: 'submission' }),
      row('entry', outcome, { actor: 'desk' }),
    ], eventCtx)
    expect(rows[0].detail).toBeNull()
    expect(rows[1].detail).toBeNull()
    // A row carrying its own absolute score still says what it is, and names only the
    // winner: the detail records who won, never who lost.
    expect(rows[2].detail).toBe('Olivia Kim won by submission, 2 to 0')
  })
})

const detail = {
  event: { id: 7, name: 'Fall Duels' },
  athletes: [
    { id: 100, firstName: 'Mateo', lastName: 'Rivera' },
    { id: 200, firstName: 'Olivia', lastName: 'Kim' },
  ],
  rulesets: [{ id: 1, actions: [{ key: 'takedown', label: 'Takedown', points: 2 }], terminals: [] }],
} as unknown as EventDetail

describe('the sources the sheet reads', () => {
  it('names a match by its mat and its pair, and carries its ruleset', () => {
    const source = matchHistorySource(sampleMatch({ id: 9, rulesetId: 1 }), 2, detail)
    expect(source.path).toBe('/api/matches/9/history')
    expect(source.title).toBe('Mat 2, Mateo Rivera vs Olivia Kim')
    expect(source.context.actions).toEqual([{ key: 'takedown', label: 'Takedown', points: 2 }])
    expect(source.context.nameOf(100)).toBe('Mateo Rivera')
  })

  it('drops the mat from the head when the match is on none', () => {
    expect(matchHistorySource(sampleMatch({ id: 9 }), null, detail).title).toBe('Mateo Rivera vs Olivia Kim')
  })

  it('reads the event log with no pair and no ruleset', () => {
    const source = eventHistorySource(detail)
    expect(source.path).toBe('/api/events/7/history')
    expect(source.context.athleteAId).toBeNull()
    expect(source.context.actions).toEqual([])
  })
})
