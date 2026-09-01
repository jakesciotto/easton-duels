import type { Composition } from './plan'

/**
 * The board's vertical arithmetic, in one place, because the stage mixes two frames and
 * only one of them moves. Every type step scales with `--far`; the 90cqh safe frame does
 * not. A band therefore cannot be a fixed number of cqh while the type inside it grows:
 * at far 1.2 the hero's own contents came to 388.71px inside a 334.8px band and the
 * plate row, the one flexible item, absorbed all 53.91px of it, so turning the deep room
 * knob UP made the plate and the team name smaller and clipped the name.
 *
 * The rule this module applies, once, for every composition:
 *
 *   1. The hero takes its own type. It is never the item that absorbs a shortfall.
 *   2. The band takes what is left after the hero, the gaps, the footer and the note.
 *   3. Where what is left will not hold a row at the floor step, the row COUNT drops.
 *      The type steps down only after the count has reached one, and a board that has
 *      dropped below the floor says so in words rather than clipping a digit.
 *
 * A deeper room buys bigger type and pays for it in queue depth, which is the trade
 * section 3.4 already states. Every composition sums to exactly 90cqh at every setting.
 */

/** The safe frame, per 3.4. Every composition budget is stated in it. */
export const SAFE_CQH = 90

/** The three type steps, in the stage frame, at far 1. b3 is the legibility floor. */
export const B1 = 22
export const B2 = 13
export const B3 = 9
/** b1 at the 0.78 a digits only slot may set, which is the wins numeral's own box. */
export const WINS_BOX = 17.16

/** The plate step per composition. Mirrored by --b-plate in board.css. */
export const PLATE: Record<Composition, number> = { cold: 10, setup: 10, mats: 10, entry: 12, done: 13 }
/** The hero budget per composition, from 3.4's table. done treats this as a ceiling. */
export const HERO: Record<Composition, number> = { cold: 31, setup: 31, mats: 31, entry: 38, done: 40 }
/** Hero to band, from the same table. */
export const HERO_GAP: Record<Composition, number> = { cold: 3, setup: 3, mats: 3, entry: 2, done: 2 }

/** The note is a b3 line and it DISPLACES: 7.6's words cannot cover a score. */
export const NOTE_GAP = 1
/** data entry's "Results entered" line, which is b3 tall. */
export const FOOTER_GAP = 1

/** done's summary: three lines per half with a stated leading between them. */
export const SUM_GAP = 1
/**
 * The three summary lines, tallest box each. The figures set line-height 0.78 and the
 * labels beside them are b3 at 1.0, and the two are baseline aligned, so a small line's
 * union box is a little taller than the figure's own: 0.5cqh per small line is the
 * measured allowance for it.
 */
export const SUM_FIGS = B1 * 0.78 + 2 * (B2 * 0.78)
/**
 * The allowance is the labels' overhang past the figures they sit beside. It follows
 * the type, so it scales with far, but it does NOT shrink when the figures shrink,
 * so it must stay outside the term sumScale divides. Scaling it too made the model
 * under-state the rendered height and let the summary overrun its band.
 */
export const SUM_ALLOW = 2 * 0.5
export const SUM_LINES = SUM_FIGS + SUM_ALLOW

/** 6.15: the last four results, and each mat's first three pairings. Ceilings, not counts. */
export const ENTRY_ROWS_MAX = 4
export const SETUP_FIRST_UP = 3
/** The "Mat N first up" head and the gap under it. */
export const SETUP_HEAD_GAP = 2

/** One and two mat panels state their row and spend the rest on the queue. */
export const MAT_ROW_1 = 20
export const MAT_ROW_2 = 18
export const MAT_QUEUE_1 = 4
export const MAT_QUEUE_2 = 1

export const FLOOR_NOTE_MATS = 'More mats than this screen fits. The rest are on the Live tab.'
export const FLOOR_NOTE_FAR = 'The far setting is too large for this screen'

export interface BoardBudget {
  /** All of these are cqh in the safe frame, except sumScale and the two counts. */
  hero: number
  heroGap: number
  band: number
  footer: number
  footerGap: number
  note: number
  noteGap: number
  /** mats: one mat's panel. setup: a column. entry: unused. */
  panel: number
  matGap: number
  /** The height of a .b-row, which is what its type steps are clamped against. */
  row: number
  /** mats: next lines under a panel. setup: pairings under a head. */
  queue: number
  /** mats: how many mat rows fit at the floor step. The rest live on the Live tab. */
  matsShown: number
  /** entry: result rows the band can hold at the floor. */
  rows: number
  /** done: the factor its summary figures step down by when the band is short. */
  sumScale: number
  /** Set when the composition can no longer say its facts at b3. */
  floorNote: string | null
}

function clampInt(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** bar 1.2 + gap 1.0 + plate + gap 1.2 + wins box, all of it type, all of it far scaled. */
export function heroContent(comp: Composition, far: number): number {
  return (1.2 + 1 + PLATE[comp] + 1.2 + WINS_BOX) * far
}

/**
 * n panels and n - 1 gaps fill the band exactly at every count the API accepts. The gap
 * narrows as the count rises so a 1920 x 1080 panel holds six mats at the floor step:
 * at far 1 the panels are 56, 27, 18, 13.25, 10.88, 9.0, 7.66 and 6.65cqh.
 */
export function matGapFor(mats: number): number {
  if (mats <= 2) return 2
  if (mats <= 4) return 1
  return 0.4
}

export function boardBudget({ comp, mats, far, note }: {
  comp: Composition
  mats: number
  far: number
  note: boolean
}): BoardBudget {
  const count = Math.max(1, mats)
  const b3 = B3 * far
  const noteH = note ? b3 : 0
  const noteGap = note ? NOTE_GAP : 0
  const heroGap = HERO_GAP[comp]
  const base = {
    heroGap, note: noteH, noteGap, footer: 0, footerGap: 0,
    matGap: 0, queue: 0, rows: 0, matsShown: 0, sumScale: 1, floorNote: null as string | null,
  }

  if (comp === 'done') {
    // The one composition whose band is taller than its hero, so the hero takes the
    // smaller of its budget and whatever the summary's own content does not need, and
    // never less than its own content.
    const content = SUM_GAP * 2 + SUM_LINES * far
    const room = SAFE_CQH - heroGap - noteGap - noteH
    const hero = Math.max(heroContent('done', far), Math.min(HERO.done * far, room - content))
    const band = room - hero
    const sumScale = Math.min(1, (band - SUM_GAP * 2 - SUM_ALLOW * far) / (SUM_FIGS * far))
    return {
      ...base, hero, band, panel: band, row: 0, sumScale,
      floorNote: B2 * far * sumScale < b3 ? FLOOR_NOTE_FAR : null,
    }
  }

  if (comp === 'entry') {
    const hero = HERO.entry * far
    const band = SAFE_CQH - hero - heroGap - FOOTER_GAP - b3 - noteGap - noteH
    const rows = clampInt(Math.floor(band / b3), 0, ENTRY_ROWS_MAX)
    const row = rows > 0 ? band / rows : band
    return {
      ...base, hero, band, footer: b3, footerGap: FOOTER_GAP, panel: row, row, rows,
      floorNote: rows === 0 ? FLOOR_NOTE_FAR : null,
    }
  }

  const hero = HERO[comp] * far
  const band = SAFE_CQH - hero - heroGap - noteGap - noteH

  if (comp === 'setup') {
    const queue = clampInt(Math.floor((band - b3 - SETUP_HEAD_GAP) / b3), 0, SETUP_FIRST_UP)
    return {
      ...base, hero, band, panel: band, row: b3, queue, matsShown: count,
      // A setup column that cannot hold a head plus one pairing is short of height,
      // which is a far setting problem: the columns sit side by side, not stacked.
      floorNote: queue === 0 ? FLOOR_NOTE_FAR : null,
    }
  }

  // 3.4: nothing on the board is smaller than b3, and a fact that cannot be said at
  // b3 is deleted from the board and lives on the Live tab. So the row COUNT drops to
  // what the band can hold at the floor. Shrinking the type instead would put every
  // name below the acuity threshold the whole board is derived from.
  let matsShown = count
  while (matsShown > 1 && (band - (matsShown - 1) * matGapFor(matsShown)) / matsShown < b3) matsShown--

  const matGap = matGapFor(matsShown)
  const panel = (band - (matsShown - 1) * matGap) / matsShown
  const row = matsShown === 1 ? Math.min(panel, MAT_ROW_1 * far)
    : matsShown === 2 ? Math.min(panel, MAT_ROW_2 * far)
    : panel
  const queue = matsShown > 2 ? 0
    : clampInt(Math.floor((panel - row) / b3), 0, matsShown === 1 ? MAT_QUEUE_1 : MAT_QUEUE_2)
  return {
    ...base, hero, band, panel, matGap, row, queue, matsShown,
    // cold paints an empty band, so it is never below anything. A single mat that
    // still will not fit is a far setting problem, not a mat count problem.
    floorNote: comp !== 'mats' ? null
      : matsShown < count ? FLOOR_NOTE_MATS
      : row < b3 ? FLOOR_NOTE_FAR
      : null,
  }
}

/**
 * The note takes a line, and taking a line can itself push a composition below the
 * floor, so the two are resolved together. Adding the note only ever shrinks the band,
 * so one extra pass reaches the fixed point.
 */
export function budgetWithNotes(input: { comp: Composition; mats: number; far: number }, notes: string[]): {
  budget: BoardBudget
  notes: string[]
} {
  let budget = boardBudget({ ...input, note: notes.length > 0 })
  if (budget.floorNote !== null && notes.length === 0) budget = boardBudget({ ...input, note: true })
  return { budget, notes: budget.floorNote === null ? notes : [...notes, budget.floorNote] }
}
