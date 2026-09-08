import { describe, it, expect } from 'vitest'
import {
  B2, B3, ENTRY_ROWS_MAX, FLOOR_NOTE_FAR, FLOOR_NOTE_MATS, FOOTER_GAP, NOTE_GAP, SAFE_CQH,
  SETUP_HEAD_GAP, SUM_ALLOW, SUM_FIGS,
  SIGN_GAP, SUM_GAP, SUM_LINES, boardBudget, budgetWithNotes, heroContent, matGapFor,
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
  return b.hero + b.heroGap + b.band + b.footerGap + b.footer + b.noteGap + b.note + b.signGap + b.sign
}

describe('the composition budget', () => {
  it('spends exactly the 90cqh safe frame at every far, with and without a note', () => {
    for (const comp of COMPS) {
      for (const far of FARS) {
        for (const note of [false, true]) {
          for (const sign of [false, true]) {
            for (const mats of [1, 4, 8]) {
              const b = boardBudget({ comp, mats, far, note, sign })
              expect(total(b), `${comp} far ${far} note ${note} sign ${sign} mats ${mats}`).toBeCloseTo(SAFE_CQH, 6)
              expect(b.band).toBeGreaterThan(0)
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
            expect(b.hero, where).toBeGreaterThanOrEqual(heroContent(comp, far) - 1e-9)
            if (comp === 'entry') {
              expect(b.rows, where).toBeGreaterThan(0)
              expect(nameStep(b.row, far), where).toBeCloseTo(B3 * far, 6)
            }
            // done has no row count to drop, so rule 3 lands on the type: it holds the
            // floor, or the board says in words that the far setting is too large. What
            // it never does is clip, and sumScale is derived from the band it was left.
            if (comp === 'done') {
              const holds = B2 * far * b.sumScale >= B3 * far - 1e-9
              expect(holds || b.floorNote === FLOOR_NOTE_FAR, where).toBe(true)
              expect(SUM_GAP * 2 + SUM_ALLOW * far + SUM_FIGS * far * b.sumScale, where).toBeLessThanOrEqual(b.band + 1e-9)
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

  it('grows the hero with the knob and always covers its own contents', () => {
    // The defect this replaces: the hero band was a fixed 31cqh while the plate and the
    // wins numeral inside it scaled, so at far 1.2 on a 1920 x 1080 stage the contents
    // needed 388.71px inside a 334.8px band and the plate row absorbed all 53.91px.
    for (const comp of COMPS) {
      let previous = 0
      for (const far of FARS) {
        const b = boardBudget({ comp, mats: 4, far, note: false })
        expect(b.hero, `${comp} at far ${far}`).toBeGreaterThanOrEqual(heroContent(comp, far) - 1e-9)
        expect(b.hero).toBeGreaterThan(previous)
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
  it('takes a b3 line of its own, out of the room the hero and the summary share', () => {
    for (const far of FARS) {
      const open = boardBudget({ comp: 'done', mats: 1, far, note: false })
      const signed = boardBudget({ comp: 'done', mats: 1, far, note: false, sign: true })
      expect(signed.sign).toBeCloseTo(B3 * far, 6)
      expect(signed.signGap).toBe(SIGN_GAP)
      // done's hero is a ceiling, not a fixed height, so the line comes out of the pair.
      expect(signed.hero + signed.band).toBeCloseTo(open.hero + open.band - B3 * far - SIGN_GAP, 6)
      expect(total(signed)).toBeCloseTo(SAFE_CQH, 6)
      // On its own the signature never costs the summary its floor at any setting.
      expect(B2 * far * signed.sumScale, `far ${far}`).toBeGreaterThanOrEqual(B3 * far - 1e-9)
      expect(signed.floorNote, `far ${far}`).toBeNull()
    }
  })

  /**
   * A certified board left running can also lose contact or hold the wake lock warning.
   * Both lines are budgeted, because sharing one slot would put two b3 lines in the
   * height of one and clip the bottom of the summary. In a deep room the two together
   * take more than done's summary can give up at the floor step, and rule 3 applies:
   * done has no row count to drop, so the type steps down and the board says in words
   * that the far setting is too large. It is the honest answer, and it is reachable only
   * with a fault on a certified board at far 1.06 and up.
   */
  it('budgets its own line beside a note, and says so when the room cannot hold both', () => {
    for (const far of FARS) {
      const both = boardBudget({ comp: 'done', mats: 1, far, note: true, sign: true })
      expect(both.note).toBeCloseTo(B3 * far, 6)
      expect(both.sign).toBeCloseTo(B3 * far, 6)
      expect(total(both)).toBeCloseTo(SAFE_CQH, 6)
      expect(both.band).toBeGreaterThan(0)
      // Whatever the setting, the summary is scaled to the band rather than overrunning.
      expect(SUM_GAP * 2 + SUM_ALLOW * far + SUM_FIGS * far * both.sumScale).toBeLessThanOrEqual(both.band + 1e-9)
    }
    expect(boardBudget({ comp: 'done', mats: 1, far: 1, note: true, sign: true }).floorNote).toBeNull()
    expect(boardBudget({ comp: 'done', mats: 1, far: 1.2, note: true, sign: true }).floorNote).toBe(FLOOR_NOTE_FAR)
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

  it('keeps four results at far 1 and drops the count rather than the floor step', () => {
    expect(boardBudget({ comp: 'entry', mats: 1, far: 1, note: false }).rows).toBe(4)
    expect(boardBudget({ comp: 'entry', mats: 1, far: 1, note: false }).row).toBeCloseTo(10, 6)
    expect(boardBudget({ comp: 'entry', mats: 1, far: 0.85, note: false }).rows).toBe(4)
    expect(boardBudget({ comp: 'entry', mats: 1, far: 1.2, note: false }).rows).toBe(2)
  })
})

describe('the closing composition', () => {
  it('never squeezes the summary out of its own band', () => {
    for (const far of FARS) {
      for (const note of [false, true]) {
        const b = boardBudget({ comp: 'done', mats: 1, far, note })
        const where = `far ${far} note ${note}`
        const content = SUM_GAP * 2 + SUM_LINES * far * b.sumScale
        expect(content, where).toBeLessThanOrEqual(b.band + 1e-9)
        expect(b.hero, where).toBeGreaterThanOrEqual(heroContent('done', far) - 1e-9)
        // The figures step down together only where they have to, and never below b3.
        expect(b.sumScale).toBeLessThanOrEqual(1)
        expect(B2 * far * b.sumScale, where).toBeGreaterThanOrEqual(B3 * far)
        expect(b.floorNote).toBeNull()
      }
    }
    expect(boardBudget({ comp: 'done', mats: 1, far: 1, note: false }).sumScale).toBe(1)
    expect(boardBudget({ comp: 'done', mats: 1, far: 1, note: false }).band).toBeCloseTo(48, 6)
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
})
