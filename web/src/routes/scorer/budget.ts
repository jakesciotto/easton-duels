/**
 * 6.16 sizes every commit control in millimetres and fixes the centre column at 320px, and
 * the shortest tablet the route targets is a 1024 x 768 iPad. Those two facts collide: the
 * stack that has to fit is taller than the viewport it has to fit in unless somebody does
 * the arithmetic. jsdom computes no layout, so the component takes its boxes from here and
 * the budget test measures the same numbers.
 */

/** The shortest viewport the column is designed against: a 1024 x 768 iPad in landscape. */
export const SHORTEST_VIEWPORT = 768

export const PAD = 24
export const COLUMN_GAP = 8
export const HEAD_GAP = 4
export const STACK_GAP = 8

/** t1: the mat and match line. */
export const MAT_LINE = 16
/** t2: the last action line, and any single line printed in the slack. */
export const LINE = 18
/** 7.6's "Not updating Ns" at t2, under the clock, only while a poll is late. */
export const STALE_LINE = 18
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

/** Undo, the minus row, their shared reason, Start/Pause, its reason, the moat, End match. */
export const STACK =
  COMMIT + SECONDARY + REASON + COMMIT + REASON + MOAT + RULE + COMMIT + 7 * STACK_GAP

export interface ColumnBudget {
  clock: number
  /** Everything whose height does not depend on what the match is doing. */
  fixed: number
  /** What is left for the alerts, the on deck line and the last action line. */
  slack: number
}

export function columnBudget(viewport: number): ColumnBudget {
  const clock = clockHeight(viewport)
  const fixed = PAD * 2 + MAT_LINE + HEAD_GAP + clock + COLUMN_GAP * 2 + STACK
  return { clock, fixed, slack: viewport - fixed }
}
