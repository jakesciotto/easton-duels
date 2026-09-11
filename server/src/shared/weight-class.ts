export interface WeightClass { index: number; label: string }

// The bands the registration prints, by their upper bound. Below 121 they are the gym's
// own steps; above it the sheet carries on in tens, so the last bound seeds the rest.
const UPPER = [39, 46, 53, 61, 70, 80, 90, 100, 110, 120]
const TOP = UPPER[UPPER.length - 1]
const STEP = 10

/**
 * The band a stored weight falls in. A weight is entered to the pound, but a sync or a
 * scale can carry a fraction, so it is rounded before the band is read: 52.6 is a 53
 * pound kid and belongs with the rest of the 47 to 53 band.
 */
export function weightClass(lbs: number): WeightClass {
  const w = Math.round(lbs)
  const i = UPPER.findIndex(upper => w <= upper)
  if (i === 0) return { index: 0, label: `Up to ${UPPER[0]} lbs` }
  if (i > 0) return { index: i, label: `${UPPER[i - 1] + 1} to ${UPPER[i]} lbs` }
  const over = Math.ceil((w - TOP) / STEP)
  return { index: UPPER.length - 1 + over, label: `${TOP + (over - 1) * STEP + 1} to ${TOP + over * STEP} lbs` }
}

/** How many bands apart two weights in pounds are. */
export function classGap(a: number, b: number): number {
  return Math.abs(weightClass(a).index - weightClass(b).index)
}
