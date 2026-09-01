/**
 * 6.16 sizes every commit control in millimetres and fixes the centre column at 320px, and
 * the shortest tablet the route targets is a 1024 x 768 iPad. Those two facts collide: the
 * stack that has to fit is taller than the viewport it has to fit in unless somebody does
 * the arithmetic. jsdom computes no layout, so the component takes its boxes from here and
 * the budget test measures the same numbers.
 *
 * What this module decides is not "is there slack" -- at the real worst case there is
 * almost none -- but WHICH ELEMENT GIVES when there is none. A scorer who cannot see the
 * expiry alarm, or cannot reach End match, has a broken screen. A scorer who cannot see the
 * last action line has a screen that is merely less helpful. So the head, the alarm and the
 * three commit controls are GUARANTEED at every height from SHORTEST_VIEWPORT upward, and
 * the reference content -- the on deck line, the last action line, a write error, and the
 * secondary minus row when it comes to that -- is what scrolls.
 */

/** The 1024 x 768 iPad's SCREEN height. It is not a viewport and never was. */
export const IPAD_SCREEN_HEIGHT = 768

/**
 * iPadOS Safari's top chrome, which runs roughly 50 CSS px with the compact tab bar and up
 * to about 90 with the expanded one. The column lays out in the visual viewport, so this
 * comes off the screen height before any of the boxes below get a look at it.
 */
export const MAX_BROWSER_CHROME = 90

/**
 * The shortest LAYOUT viewport this column has to survive: the iPad's screen height MINUS
 * the browser chrome above. Do NOT restore the screen height here. Against 768 the
 * arithmetic reports 75px of slack on a tablet that has at best 25 and at worst -15, which
 * is how the expiry alarm ended up squeezed into a scroll box and End match ended up below
 * the fold.
 */
export const SHORTEST_VIEWPORT = IPAD_SCREEN_HEIGHT - MAX_BROWSER_CHROME

export const PAD = 24
export const COLUMN_GAP = 8
export const HEAD_GAP = 4
export const STACK_GAP = 8

/** t1: the mat and match identity. */
export const MAT_LINE = 16
/** t2: the last action line, and any single line printed in the reference region. */
export const LINE = 18
/** 7.6's "Not updating Ns" at t2, printed while a poll is late. */
export const STALE_LINE = 18
/**
 * The head's single status line. The staleness notice prints INSTEAD of the mat identity
 * rather than under it: a second line in the head is 18px taken straight out of the
 * guarantee below, and between "which mat is this" and "these numbers are not moving" the
 * one worth the row is the one that changes.
 */
export const HEAD_LINE = Math.max(MAT_LINE, STALE_LINE)
/** An Alert: py-3 either side of one t3 line. */
export const ALERT = 44

/** 6.16: 20mm at the iPad's 132 CSS ppi. Undo, Start/Pause and End match. */
export const COMMIT = 104
/** 6.16: secondary controls. The two per side minus buttons. */
export const SECONDARY = 64
/** One t2 refusal line and its leading, reserved whether or not there is a reason to print. */
export const REASON = 24
/** 6.16's moat, and the rule that closes it. */
export const MOAT = 32
export const RULE = 1

/** 6.16: 12vh, minimum 96. */
export function clockHeight(viewport: number): number {
  return Math.max(viewport * 0.12, 96)
}

/**
 * The minus row and the gap above it. It is 6.16's SECONDARY class, not a commit control,
 * which is what makes it the one part of the stack allowed to leave it for the reference
 * region. Nothing here ever buys the fit by shrinking a commit control below 104px.
 */
export const MINUS_ROW = SECONDARY + STACK_GAP

/** Undo, the shared reason, Start/Pause, its reason, the moat and its rule, End match. */
export const STACK_COMMIT =
  COMMIT + REASON + COMMIT + REASON + MOAT + RULE + COMMIT + 6 * STACK_GAP

/** The whole stack when the height pays for the minus row too. */
export const STACK = STACK_COMMIT + MINUS_ROW

export interface ColumnBudget {
  clock: number
  /**
   * The head, the expiry alarm and the commit controls: the boxes that may never be the
   * element that scrolls away. Measured with the alarm SHOWING, because the moment it is
   * showing is the moment the column is asked to hold the most.
   */
  guaranteed: number
  /** Whether the secondary minus row can stay in the commit stack at this height. */
  minusRowFixed: boolean
  /** guaranteed, plus the minus row when it stays. */
  fixed: number
  /** What is left for the reference content, which is what gives. */
  slack: number
}

export function columnBudget(viewport: number): ColumnBudget {
  const clock = clockHeight(viewport)
  // Three column gaps -- head to alarm, alarm to reference, reference to stack -- because
  // the reference region can shrink to zero but the gaps around it cannot.
  const guaranteed =
    PAD * 2 + HEAD_LINE + HEAD_GAP + clock + COLUMN_GAP * 3 + ALERT + STACK_COMMIT
  const minusRowFixed = viewport - guaranteed >= MINUS_ROW
  const fixed = guaranteed + (minusRowFixed ? MINUS_ROW : 0)
  return { clock, guaranteed, minusRowFixed, fixed, slack: viewport - fixed }
}
