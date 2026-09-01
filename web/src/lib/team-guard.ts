import { TEAM_COLORS, TEAM_COLOR_KEYS, TEAM_COLOR_LABELS, type TeamColor } from '@shared/types'

// The eight hues from 2.4, in degrees. They are the authored OKLCH hues rather than
// hues re-measured off the shipped sRGB hexes, because three of the eight are chroma
// clipped and a re-measured hue would move the separation table under the copy.
const HUE: Record<TeamColor, number> = {
  red: 25, orange: 68, green: 112, amber: 150, teal: 196, blue: 250, purple: 300, pink: 340,
}

// Guard 1 blocks a pair closer than 60 degrees, which on this wheel is exactly the two
// ring neighbours. Guard 2 blocks a pair that simulates closer than dE00 20 under either
// dichromacy, and warns between 20 and 30.
export const HUE_FLOOR = 60
export const CONFUSION_FLOOR = 20
export const CONFUSION_WARN = 30

export type GuardLevel = 'ok' | 'warn' | 'block'
export interface PairVerdict {
  level: GuardLevel
  /** Generated from the tables below. Never hand written: a hand written string is how a
   *  previous revision came to name a pair 125 degrees apart as too close to tell apart. */
  reason: string | null
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const hexToLinear = (hex: string) => [1, 3, 5].map(i => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255))

// Vienot, Brettel and Mollon (1999): to LMS, collapse the missing cone onto the
// dichromat plane, back to linear RGB. No dependency and no lookup table.
function simulate(hex: string, kind: 'deuteranopia' | 'protanopia'): number[] {
  const [r, g, b] = hexToLinear(hex)
  const L = 17.8824 * r + 43.5161 * g + 4.11935 * b
  const M = 3.45565 * r + 27.1554 * g + 3.86714 * b
  const S = 0.0299566 * r + 0.184309 * g + 1.46709 * b
  const l = kind === 'protanopia' ? 2.02344 * M - 2.52581 * S : L
  const m = kind === 'deuteranopia' ? 0.494207 * L + 1.24827 * S : M
  return [
    0.080944 * l - 0.130504 * m + 0.116721 * S,
    -0.0102485 * l + 0.0540194 * m - 0.113615 * S,
    -0.000365294 * l - 0.00412163 * m + 0.693513 * S,
  ].map(v => Math.min(1, Math.max(0, v)))
}

function toLab([r, g, b]: number[]): number[] {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function deltaE00([L1, a1, b1]: number[], [L2, a2, b2]: number[]): number {
  const rad = Math.PI / 180
  const deg = 180 / Math.PI
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)))
  const ap1 = (1 + g) * a1
  const ap2 = (1 + g) * a2
  const cp1 = Math.hypot(ap1, b1)
  const cp2 = Math.hypot(ap2, b2)
  const hue = (b: number, ap: number) => {
    if (b === 0 && ap === 0) return 0
    const h = Math.atan2(b, ap) * deg
    return h < 0 ? h + 360 : h
  }
  const hp1 = hue(b1, ap1)
  const hp2 = hue(b2, ap2)
  const dLp = L2 - L1
  const dCp = cp2 - cp1
  let dhp = 0
  if (cp1 * cp2 !== 0) {
    dhp = hp2 - hp1
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dhp * rad) / 2)
  const lbp = (L1 + L2) / 2
  const cbp = (cp1 + cp2) / 2
  let hbp = hp1 + hp2
  if (cp1 * cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) hbp += hbp < 360 ? 360 : -360
    hbp /= 2
  }
  const t = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad)
  const sl = 1 + (0.015 * (lbp - 50) ** 2) / Math.sqrt(20 + (lbp - 50) ** 2)
  const sc = 1 + 0.045 * cbp
  const sh = 1 + 0.015 * cbp * t
  const rt = -Math.sin(2 * (30 * Math.exp(-(((hbp - 275) / 25) ** 2))) * rad)
    * (2 * Math.sqrt(cbp ** 7 / (cbp ** 7 + 25 ** 7)))
  return Math.sqrt((dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh))
}

export function hueSeparation(a: TeamColor, b: TeamColor): number {
  const d = Math.abs(HUE[a] - HUE[b]) % 360
  return d > 180 ? 360 - d : d
}

/** The worse of the two dichromacies, because the pair has to survive both. */
export function confusion(a: TeamColor, b: TeamColor): number {
  const under = (kind: 'deuteranopia' | 'protanopia') =>
    deltaE00(toLab(simulate(TEAM_COLORS[a], kind)), toLab(simulate(TEAM_COLORS[b], kind)))
  return Math.min(under('deuteranopia'), under('protanopia'))
}

function legalPartners(chosen: TeamColor): TeamColor[] {
  return TEAM_COLOR_KEYS.filter(c => c !== chosen && hueSeparation(chosen, c) >= HUE_FLOOR && confusion(chosen, c) >= CONFUSION_FLOOR)
}

/**
 * The two most separated legal partners, printed in the palette's own order so the
 * suggestion reads in the same sequence as the grid the organizer is looking at.
 */
export function suggestions(chosen: TeamColor): TeamColor[] {
  const best = [...legalPartners(chosen)].sort((x, y) => hueSeparation(chosen, y) - hueSeparation(chosen, x)).slice(0, 2)
  return TEAM_COLOR_KEYS.filter(c => best.includes(c))
}

const swapCopy = (chosen: TeamColor) => suggestions(chosen).map(c => TEAM_COLOR_LABELS[c]).join(' or ')

export function pairVerdict(chosen: TeamColor, candidate: TeamColor): PairVerdict {
  if (chosen === candidate) {
    return { level: 'block', reason: `${TEAM_COLOR_LABELS[chosen]} is already the other team. Try ${swapCopy(chosen)}.` }
  }
  // Guard 1 first where both fire: distance is the reason the organizer will actually
  // see across the gym, and guard 2's set is a strict superset of it.
  if (hueSeparation(chosen, candidate) < HUE_FLOOR) {
    return {
      level: 'block',
      reason: `${TEAM_COLOR_LABELS[chosen]} and ${TEAM_COLOR_LABELS[candidate]} look the same from the back of the gym. Try ${swapCopy(chosen)}.`,
    }
  }
  const dE = confusion(chosen, candidate)
  if (dE < CONFUSION_FLOOR) {
    return { level: 'block', reason: `These two look the same to about one person in twelve. Try ${swapCopy(chosen)}.` }
  }
  if (dE < CONFUSION_WARN) {
    return {
      level: 'warn',
      reason: `${TEAM_COLOR_LABELS[chosen]} and ${TEAM_COLOR_LABELS[candidate]} are close under colour blindness. The three letter codes still tell them apart.`,
    }
  }
  return { level: 'ok', reason: null }
}
