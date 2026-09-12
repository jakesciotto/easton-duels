import { describe, it, expect } from 'vitest'
import {
  B2, B3, ENTRY_ROWS_MAX, FLOOR_NOTE_FAR, FLOOR_NOTE_MATS, FOOTER_GAP, NOTE_GAP, RESULT_GAP,
  SAFE_CQH, SETUP_HEAD_GAP,
  SIGN_GAP, boardBudget, budgetWithNotes, lbGapFor, lbRowFor, matGapFor, maxFarFor,
} from '@/routes/board/budget'
import type { Composition } from '@/routes/board/plan'

/**
 * The board mixes two frames: every type step scales with --far and the 90cqh safe
 * frame does not. This suite is the arithmetic that keeps them honest, at the three
 * settings 3.4 documents and at every mat count the API accepts.
 */

const FARS = [0.85, 1, 1.2]
const COMPS: Composition[] = ['cold', 'setup', 'mats', 'entry', 'done']

/** What board.css derives from --b-row-n, so a test can measure the same boxes. */
function nameStep(row: number, far: number): number {
  return Math.min(B3 * far, row)
}
function scoreBox(comp: Composition, row: number, far: number): number {
  // Data entry's figures set line-height 0.76, every other row sets 1.
  if (comp === 'entry') return Math.min(B2 * far, row / 0.76) * 0.76
  return Math.min(B2 * far, row)
}

function total(b: ReturnType<typeof boardBudget>): number {
  return b.hero + b.heroGap + b.band + b.footerGap + b.footer
    + b.resultGap + b.result + b.noteGap + b.note + b.signGap + b.sign
}

describe('the composition budget', () => {
  it('spends exactly the 90cqh safe frame at every far, with and without a note', () => {
    for (const comp of COMPS) {
      for (const far of FARS) {
        for (const note of [false, true]) {
          for (const sign of [false, true]) {
            for (const mats of [1, 4, 8]) {
              const b = boardBudget({ comp, mats, far, note, sign })
              const where = `${comp} far ${far} note ${note} sign ${sign} mats ${mats}`
              expect(total(b), where).toBeCloseTo(SAFE_CQH, 6)
              // done draws no band at all: the standings are the whole panel.
              expect(comp === 'done' ? b.hero : b.band, where).toBeGreaterThan(0)
            }
          }
        }
      }
    }
  })

  it('clips nothing anywhere across the knob\'s whole range', () => {
    // The three documented settings are checked exactly elsewhere. This is the sweep
    // between them, because ?far= takes any value the clamp in useFar allows.
    for (let far = 0.85; far <= 1.2001; far += 0.01) {
      for (const comp of COMPS) {
        for (const [note, sign] of [[false, false], [true, false], [false, true], [true, true]] as const) {
          for (const mats of [1, 2, 3, 4, 5, 6, 7, 8]) {
            const b = boardBudget({ comp, mats, far, note, sign })
            const where = `${comp} ${mats} mats at far ${far.toFixed(2)} note ${note} sign ${sign}`
            expect(total(b), where).toBeCloseTo(SAFE_CQH, 6)
            expect(lbRowFor(b.hero, 2, far), where).toBeGreaterThanOrEqual(B3 * far - 1e-9)
            if (comp === 'entry') {
              expect(b.rows, where).toBeGreaterThan(0)
              expect(nameStep(b.row, far), where).toBeCloseTo(B3 * far, 6)
            }
            // done spends its whole frame on the standings and the lines under them,
            // so what it has to hold is the rows, not a band.
            if (comp === 'done') {
              expect(b.band, where).toBe(0)
              expect(b.result, where).toBeCloseTo(B3 * far, 6)
              expect(lbRowFor(b.hero, 2, far), where).toBeGreaterThanOrEqual(B3 * far - 1e-9)
            }
            if (comp === 'setup') expect(b.queue, where).toBeGreaterThan(0)
            if (comp === 'mats') {
              // The rendered count fills the band. A count the band cannot hold at the
              // floor is not shrunk to fit, it is dropped and named in a note.
              expect(b.matsShown * b.panel + (b.matsShown - 1) * b.matGap, where).toBeCloseTo(b.band, 6)
              expect(b.matsShown, where).toBeLessThanOrEqual(mats)
              expect(b.row + b.queue * B3 * far, where).toBeLessThanOrEqual(b.panel + 1e-9)
            }
            expect(scoreBox(comp, b.row, far), where).toBeLessThanOrEqual(Math.max(b.row, 0) + 1e-9)
          }
        }
      }
    }
  })

  it('never has to say the far setting is too large', () => {
    // The knob is capped by the team count and the hero yields to the band's own
    // minimum, so no composition can be left under its floor by the setting alone. The
    // guards in budget.ts stay as a tripwire; nothing the board can be opened at trips
    // them, and a board that fills up says so about the mat count instead.
    for (const comp of COMPS) {
      for (const teams of [2, 3, 4, 5, 6, 7, 8]) {
        for (const far of FARS.filter(f => f <= maxFarFor(teams))) {
          for (const mats of [1, 2, 4, 8]) {
            for (const note of [false, true]) {
              const b = boardBudget({ comp, mats, teams, far, note, sign: comp === 'done' })
              expect(b.floorNote, `${comp}, ${teams} teams, ${mats} mats at far ${far}`).not.toBe(FLOOR_NOTE_FAR)
            }
          }
        }
      }
    }
  })

  it('grows the hero with the knob and always holds its rows at the floor', () => {
    // The defect this replaces: the hero band was a fixed 31cqh while the type inside it
    // scaled, so at far 1.2 on a 1920 x 1080 stage the contents needed 388.71px inside a
    // 334.8px band and the one flexible item absorbed all 53.91px.
    for (const comp of COMPS) {
      let previous = 0
      for (const far of FARS) {
        const b = boardBudget({ comp, mats: 4, far, note: false })
        expect(lbRowFor(b.hero, 2, far), `${comp} at far ${far}`).toBeGreaterThanOrEqual(B3 * far - 1e-9)
        // done is the one composition the knob shrinks: the lines under its standings
        // are type too, and they take their b3 out of the panel above them.
        if (comp !== 'done') expect(b.hero, `${comp} at far ${far}`).toBeGreaterThan(previous)
        previous = b.hero
      }
    }
  })

  it('states the live hero and band at the three documented settings', () => {
    const at = (far: number) => boardBudget({ comp: 'mats', mats: 4, far, note: false })
    // 31F hero, a 3cqh gap, and the band takes the remainder: 90 - 31F - 3.
    expect(at(0.85).hero).toBeCloseTo(26.35, 6)
    expect(at(0.85).band).toBeCloseTo(60.65, 6)
    expect(at(1).hero).toBeCloseTo(31, 6)
    expect(at(1).band).toBeCloseTo(56, 6)
    expect(at(1.2).hero).toBeCloseTo(37.2, 6)
    expect(at(1.2).band).toBeCloseTo(49.8, 6)
  })
})

/**
 * 7.1's hero: a row per team. Under five teams the rows fit the 31cqh hero budget and
 * nothing else moves; above it the hero grows and the mat band pays, down to the single
 * floor row an eight team event leaves it. The mockup's own frames are the table below.
 */
describe('the leaderboard hero', () => {
  const TEAM_COUNTS = [2, 3, 4, 5, 6, 7, 8]

  it('fills the hero with its rows and their gaps at every count and every setting', () => {
    for (const far of FARS) {
      for (const teams of TEAM_COUNTS) {
        for (const comp of COMPS) {
          const b = boardBudget({ comp, mats: 4, teams, far, note: false })
          const where = `${comp}, ${teams} teams at far ${far}`
          const row = lbRowFor(b.hero, teams, far)
          expect(teams * row + (teams - 1) * b.lbGap, where).toBeCloseTo(b.hero, 6)
          expect(b.lbRows, where).toBe(teams)
          expect(b.lbGap, where).toBeCloseTo(lbGapFor(teams) * far, 6)
          expect(row, where).toBeGreaterThan(0)
          expect(total(b), where).toBeCloseTo(SAFE_CQH, 6)
        }
      }
    }
  })

  it('keeps the rows at the b3 floor while the room holds them', () => {
    // The knob is clamped against the count, so every setting a board can actually be
    // opened at holds the floor. Past the cap the type steps down rather than clipping.
    for (const teams of TEAM_COUNTS) {
      for (const far of FARS.filter(f => f <= maxFarFor(teams))) {
        const b = boardBudget({ comp: 'mats', mats: 2, teams, far, note: false })
        expect(lbRowFor(b.hero, teams, far), `${teams} teams at far ${far}`).toBeGreaterThanOrEqual(B3 * far - 1e-9)
      }
    }
  })

  it('states the mockup composition at two, three and eight teams', () => {
    const at = (teams: number) => boardBudget({ comp: 'mats', mats: 2, teams, far: 1, note: false })
    // Frame 4: two rows of 14.75cqh, and the band is byte for byte today's.
    expect(at(2).hero).toBeCloseTo(31, 6)
    expect(lbRowFor(at(2).hero, 2, 1)).toBeCloseTo(14.75, 6)
    expect(at(2).band).toBeCloseTo(56, 6)
    expect(at(2).clock).toBe(true)
    // Frame 1: three rows of 9.53cqh, which is the floor, and the same band.
    expect(at(3).hero).toBeCloseTo(31, 6)
    expect(lbRowFor(at(3).hero, 3, 1)).toBeCloseTo(9.5333, 4)
    expect(at(3).band).toBeCloseTo(56, 6)
    expect(at(3).clock).toBe(true)
    // Frame 6A: 78 + 3 + 9 is the whole safe frame. One mat row, no queue, no clock.
    expect(at(8).hero).toBeCloseTo(78, 6)
    expect(lbRowFor(at(8).hero, 8, 1)).toBeCloseTo(9.4, 6)
    expect(at(8).band).toBeCloseTo(9, 6)
    expect(at(8).matsShown).toBe(1)
    expect(at(8).queue).toBe(0)
    expect(at(8).clock).toBe(false)
    expect(at(8).hero + at(8).heroGap + at(8).band).toBeCloseTo(SAFE_CQH, 6)
  })

  it('grows the hero one count at a time rather than in one cliff', () => {
    const hero = (teams: number) => boardBudget({ comp: 'mats', mats: 2, teams, far: 1, note: false }).hero
    expect(TEAM_COUNTS.map(hero)).toEqual([31, 31, 39.6, 46.6, 56, 65.4, 78])
    for (const teams of [5, 6, 7, 8]) expect(hero(teams), `${teams} teams`).toBeGreaterThan(hero(teams - 1))
  })

  it('caps the far knob against the team count', () => {
    // Eight floor rows at 1.2 are 86.4cqh plus 3.36 of gaps, which is the whole frame.
    expect(maxFarFor(8)).toBeLessThan(1.2)
    expect(maxFarFor(8)).toBeGreaterThanOrEqual(1)
    for (const teams of [2, 3, 4, 5, 6]) expect(maxFarFor(teams), `${teams} teams`).toBeGreaterThanOrEqual(1.2)
    // At the cap the composition still holds a mat row at the floor, exactly.
    for (const teams of TEAM_COUNTS) {
      const far = maxFarFor(teams)
      const b = boardBudget({ comp: 'mats', mats: 1, teams, far, note: false })
      expect(b.band, `${teams} teams`).toBeGreaterThanOrEqual(B3 * far - 1e-9)
      expect(total(b), `${teams} teams`).toBeCloseTo(SAFE_CQH, 6)
    }
  })

  it('says nothing about the far setting when the count is what filled the screen', () => {
    // FLOOR_NOTE_FAR would be a lie: the knob is already clamped to the count, and at
    // eight teams there is no line left to print a note on without pushing the rows
    // under their own floor. A board already carrying a note says both on that line.
    const eight = budgetWithNotes({ comp: 'mats', mats: 4, teams: 8, far: 1 }, [])
    expect(eight.notes).toEqual([])
    expect(eight.budget.note).toBe(0)
    expect(total(eight.budget)).toBeCloseTo(SAFE_CQH, 6)

    const seven = budgetWithNotes({ comp: 'mats', mats: 4, teams: 7, far: 1 }, [])
    expect(seven.notes).toEqual([FLOOR_NOTE_MATS])
    expect(lbRowFor(seven.budget.hero, 7, 1)).toBeGreaterThanOrEqual(B3 - 1e-9)

    const quiet = budgetWithNotes({ comp: 'mats', mats: 4, teams: 8, far: 1 }, ['Not updating 12s'])
    expect(quiet.notes).toEqual(['Not updating 12s', FLOOR_NOTE_MATS])
    expect(total(quiet.budget)).toBeCloseTo(SAFE_CQH, 6)
  })
})

describe('the note', () => {
  it('displaces a b3 line rather than painting over one', () => {
    // A four mat board that went quiet used to have the note painted over the bottom
    // 97.2px of the safe area, which is most of mat 4's own name line.
    for (const far of FARS) {
      const quiet = boardBudget({ comp: 'mats', mats: 4, far, note: false })
      const noted = boardBudget({ comp: 'mats', mats: 4, far, note: true })
      expect(noted.note).toBeCloseTo(B3 * far, 6)
      expect(noted.noteGap).toBe(NOTE_GAP)
      expect(noted.band).toBeCloseTo(quiet.band - B3 * far - NOTE_GAP, 6)
      expect(total(noted)).toBeCloseTo(SAFE_CQH, 6)
      // The mats still fill the band they were left, so nothing hangs under the note.
      expect(noted.matsShown * noted.panel + (noted.matsShown - 1) * noted.matGap).toBeCloseTo(noted.band, 6)
    }
  })

  it('resolves the note it adds together with the line that note costs', () => {
    // Seven mats cannot hold the floor step, which raises a note, which takes a line,
    // which cannot un-raise it. One pass reaches the fixed point.
    const { budget, notes } = budgetWithNotes({ comp: 'mats', mats: 7, far: 1 }, [])
    expect(notes).toEqual([FLOOR_NOTE_MATS])
    expect(budget.note).toBeCloseTo(B3, 6)
    expect(total(budget)).toBeCloseTo(SAFE_CQH, 6)

    const quiet = budgetWithNotes({ comp: 'mats', mats: 4, far: 1 }, [])
    expect(quiet.notes).toEqual([])
    expect(quiet.budget.note).toBe(0)

    const both = budgetWithNotes({ comp: 'mats', mats: 8, far: 1 }, ['Not updating 12s'])
    expect(both.notes).toEqual(['Not updating 12s', FLOOR_NOTE_MATS])
    expect(total(both.budget)).toBeCloseTo(SAFE_CQH, 6)
  })
})

describe('the certified line', () => {
  it('takes a b3 line of its own, out of the standings above it', () => {
    for (const far of FARS) {
      const open = boardBudget({ comp: 'done', mats: 1, far, note: false })
      const signed = boardBudget({ comp: 'done', mats: 1, far, note: false, sign: true })
      expect(signed.sign).toBeCloseTo(B3 * far, 6)
      expect(signed.signGap).toBe(SIGN_GAP)
      // The standings are the only item that can give a line up, so they do.
      expect(signed.hero).toBeCloseTo(open.hero - B3 * far - SIGN_GAP, 6)
      expect(total(signed)).toBeCloseTo(SAFE_CQH, 6)
      expect(signed.floorNote, `far ${far}`).toBeNull()
    }
  })

  /**
   * A certified board left running can also lose contact or hold the wake lock warning.
   * Both lines are budgeted, because sharing one slot would put two b3 lines in the
   * height of one and clip what is above them. The standings pay for all of it and stay
   * above their own floor at every setting the knob offers.
   */
  it('budgets its own line beside the result line and a note', () => {
    for (const far of FARS) {
      const both = boardBudget({ comp: 'done', mats: 1, far, note: true, sign: true })
      expect(both.note).toBeCloseTo(B3 * far, 6)
      expect(both.sign).toBeCloseTo(B3 * far, 6)
      expect(both.result).toBeCloseTo(B3 * far, 6)
      expect(both.resultGap).toBe(RESULT_GAP)
      expect(total(both)).toBeCloseTo(SAFE_CQH, 6)
      expect(lbRowFor(both.hero, 2, far), `far ${far}`).toBeGreaterThanOrEqual(B3 * far - 1e-9)
      expect(both.floorNote, `far ${far}`).toBeNull()
    }
  })

  it('belongs to done alone, whatever a caller asks for', () => {
    for (const comp of COMPS) {
      expect(boardBudget({ comp, mats: 4, far: 1, note: false }).sign, comp).toBe(0)
      const asked = boardBudget({ comp, mats: 4, far: 1, note: false, sign: true })
      if (comp === 'done') continue
      expect(asked.sign, comp).toBe(0)
      expect(asked.signGap, comp).toBe(0)
    }
  })
})

describe('the mat band', () => {
  it('fills the band and holds its own type at every count the API accepts', () => {
    for (const far of FARS) {
      for (const mats of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const b = boardBudget({ comp: 'mats', mats, far, note: false })
        const where = `${mats} mats at far ${far}`
        expect(b.matsShown * b.panel + (b.matsShown - 1) * b.matGap, where).toBeCloseTo(b.band, 6)
        expect(b.matGap).toBe(matGapFor(b.matsShown))
        // The row and everything under it fit inside the panel that holds them.
        expect(b.row + b.queue * B3 * far, where).toBeLessThanOrEqual(b.panel + 1e-9)
        // The tallest line box in the row fits the row. This is the defect: a six mat
        // panel was 96.3px while the b2 score line box was a fixed 140.4px, so 22px
        // was cut off each end of every digit.
        expect(scoreBox('mats', b.row, far), where).toBeLessThanOrEqual(b.row + 1e-9)
        expect(nameStep(b.row, far), where).toBeLessThanOrEqual(b.row + 1e-9)
      }
    }
  })

  it('steps the score down from b2 as the count rises and says so past the floor', () => {
    const at = (mats: number) => boardBudget({ comp: 'mats', mats, far: 1, note: false })
    // A 1920 x 1080 panel at far 1: b2 through four mats, stepping down at five, the
    // b3 floor exactly at six, and below the floor at seven and eight.
    expect(scoreBox('mats', at(4).row, 1)).toBeCloseTo(B2, 6)
    expect(scoreBox('mats', at(5).row, 1)).toBeCloseTo(10.88, 6)
    expect(scoreBox('mats', at(6).row, 1)).toBeCloseTo(B3, 6)
    for (const mats of [1, 2, 3, 4, 5, 6]) expect(at(mats).floorNote, `${mats} mats`).toBeNull()
    for (const mats of [7, 8]) expect(at(mats).floorNote, `${mats} mats`).toBe(FLOOR_NOTE_MATS)
  })

  it('spends what a one or two mat panel has left on the queue', () => {
    expect(boardBudget({ comp: 'mats', mats: 1, far: 1, note: false }).queue).toBe(4)
    expect(boardBudget({ comp: 'mats', mats: 2, far: 1, note: false }).queue).toBe(1)
    // A deeper room buys bigger type and pays for it in queue depth.
    expect(boardBudget({ comp: 'mats', mats: 1, far: 1.2, note: false }).queue).toBe(2)
    expect(boardBudget({ comp: 'mats', mats: 2, far: 1.2, note: false }).queue).toBe(0)
    for (const mats of [3, 4, 8]) {
      expect(boardBudget({ comp: 'mats', mats, far: 1, note: false }).queue).toBe(0)
    }
  })
})

describe('the data entry composition', () => {
  it('fills its band with rows that hold both the name and the score', () => {
    for (const far of FARS) {
      for (const note of [false, true]) {
        const b = boardBudget({ comp: 'entry', mats: 1, far, note })
        const where = `far ${far} note ${note}`
        expect(b.footer, where).toBeCloseTo(B3 * far, 6)
        expect(b.footerGap).toBe(FOOTER_GAP)
        expect(b.rows).toBeGreaterThan(0)
        expect(b.rows).toBeLessThanOrEqual(ENTRY_ROWS_MAX)
        expect(b.rows * b.row, where).toBeCloseTo(b.band, 6)
        expect(nameStep(b.row, far), where).toBeCloseTo(B3 * far, 6)
        expect(scoreBox('entry', b.row, far), where).toBeLessThanOrEqual(b.row + 1e-9)
        expect(b.floorNote).toBeNull()
      }
    }
  })

  it('keeps a result row whatever the hero wants, and pins where eight teams land', () => {
    // The desk band never gives up its last row, so the hero is capped at room - b3 and
    // the standings, not the results, are what a large team count shortens.
    for (const teams of [2, 3, 4, 5, 6, 7]) {
      const b = boardBudget({ comp: 'entry', mats: 1, teams, far: 1, note: false })
      expect(lbRowFor(b.hero, teams, 1), `${teams} teams`).toBeGreaterThanOrEqual(B3 - 1e-9)
    }
    // Eight is the cap count and the shortfall there is accepted: the desk panel is read
    // between bouts, not all afternoon, and a composition aware far cap would shrink the
    // live mats board instead. Pinned so it cannot get worse unnoticed.
    const eight = boardBudget({ comp: 'entry', mats: 1, teams: 8, far: 1, note: false })
    expect(eight.hero).toBeCloseTo(69, 6)
    expect(eight.rows).toBe(1)
    expect(eight.row).toBeCloseTo(B3, 6)
    expect(lbRowFor(eight.hero, 8, 1)).toBeCloseTo(8.275, 6)
    expect(total(eight)).toBeCloseTo(SAFE_CQH, 6)
  })

  it('keeps four results at far 1 and drops the count rather than the floor step', () => {
    expect(boardBudget({ comp: 'entry', mats: 1, far: 1, note: false }).rows).toBe(4)
    expect(boardBudget({ comp: 'entry', mats: 1, far: 1, note: false }).row).toBeCloseTo(10, 6)
    expect(boardBudget({ comp: 'entry', mats: 1, far: 0.85, note: false }).rows).toBe(4)
    expect(boardBudget({ comp: 'entry', mats: 1, far: 1.2, note: false }).rows).toBe(2)
  })
})

describe('the closing composition', () => {
  it('is one panel: the standings, the result line and the certified line', () => {
    // Frame 3's budget: 70 + 1 + 9 + 1 + 9 is the whole safe frame, and both closing
    // lines displace rather than overlaying the standings.
    const certified = boardBudget({ comp: 'done', mats: 1, teams: 3, far: 1, note: false, sign: true })
    expect(certified.hero).toBeCloseTo(70, 6)
    expect(certified.band).toBe(0)
    expect(certified.heroGap).toBe(0)
    expect(lbRowFor(certified.hero, 3, 1)).toBeCloseTo(22.5333, 4)
    expect(total(certified)).toBeCloseTo(SAFE_CQH, 6)
    // Before certification the standings take that line back.
    expect(boardBudget({ comp: 'done', mats: 1, teams: 3, far: 1, note: false }).hero).toBeCloseTo(80, 6)
  })

  it('holds its rows at the floor through seven teams on a certified board', () => {
    for (const teams of [2, 3, 4, 5, 6, 7]) {
      const b = boardBudget({ comp: 'done', mats: 1, teams, far: 1, note: false, sign: true })
      expect(lbRowFor(b.hero, teams, 1), `${teams} teams`).toBeGreaterThanOrEqual(B3 - 1e-9)
    }
    // Eight teams is the count the closing panel cannot hold at the floor. The lines
    // under the standings are not negotiable and there is no band left to take it out
    // of, so the rows step down 7 percent rather than the sentence going unsaid.
    expect(lbRowFor(boardBudget({ comp: 'done', mats: 1, teams: 8, far: 1, note: false, sign: true }).hero, 8, 1))
      .toBeCloseTo(8.4, 6)
  })

  it('spends the whole frame and clips nothing at every count and setting', () => {
    // Where the closing lines take more than the standings can give at the floor, the
    // row shortens and the type follows it down: --lb-name is min(b3, the row). What
    // never happens is a panel that overruns the frame or a row with no height at all.
    for (const teams of [2, 3, 4, 5, 6, 7, 8]) {
      for (const far of FARS.filter(f => f <= maxFarFor(teams))) {
        for (const note of [false, true]) {
          for (const sign of [false, true]) {
            const b = boardBudget({ comp: 'done', mats: 1, teams, far, note, sign })
            const where = `${teams} teams at far ${far} note ${note} sign ${sign}`
            expect(total(b), where).toBeCloseTo(SAFE_CQH, 6)
            expect(lbRowFor(b.hero, teams, far), where).toBeGreaterThan(0)
            expect(b.floorNote, where).toBeNull()
          }
        }
      }
    }
  })
})

describe('the setup composition', () => {
  it('holds a head and as many pairings as the column has room for', () => {
    for (const far of FARS) {
      for (const note of [false, true]) {
        const b = boardBudget({ comp: 'setup', mats: 4, far, note })
        const where = `far ${far} note ${note}`
        expect(B3 * far + SETUP_HEAD_GAP + b.queue * B3 * far, where).toBeLessThanOrEqual(b.band + 1e-9)
        expect(b.floorNote).toBeNull()
      }
    }
    expect(boardBudget({ comp: 'setup', mats: 4, far: 1, note: false }).queue).toBe(3)
  })

  it('keeps a head over one pairing whatever the hero wants, and pins eight teams', () => {
    for (const teams of [2, 3, 4, 5, 6, 7]) {
      const b = boardBudget({ comp: 'setup', mats: 4, teams, far: 1, note: false })
      expect(lbRowFor(b.hero, teams, 1), `${teams} teams`).toBeGreaterThanOrEqual(B3 - 1e-9)
    }
    // Eight is the cap count and the shortfall there is accepted: the setup board is on
    // the screen until the first whistle, and clipping the running order under it would
    // be the worse trade. Pinned so it cannot get worse unnoticed.
    const eight = boardBudget({ comp: 'setup', mats: 4, teams: 8, far: 1, note: false })
    expect(eight.hero).toBeCloseTo(67, 6)
    expect(eight.band).toBeCloseTo(2 * B3 + SETUP_HEAD_GAP, 6)
    expect(eight.queue).toBe(1)
    expect(lbRowFor(eight.hero, 8, 1)).toBeCloseTo(8.025, 6)
    expect(total(eight)).toBeCloseTo(SAFE_CQH, 6)
  })
})
