import { KIDS_BELTS } from '../shared/types.js'

const FAMILY: Record<string, number> = { white: 0, grey: 1, yellow: 2, orange: 3, green: 4 }

function ladder(belt: string | null): { family: number; step: number } | null {
  if (!belt || !(KIDS_BELTS as readonly string[]).includes(belt)) return null
  const [family, stripe] = belt.split('-')
  return { family: FAMILY[family], step: stripe === 'white' ? 0 : stripe === 'black' ? 2 : 1 }
}

// A belt family is a whole step and a stripe a third of one. An unknown belt is held two
// families away, which is far enough to lose a tie without excluding the pair.
export function beltDistance(a: string | null, b: string | null): number {
  const la = ladder(a)
  const lb = ladder(b)
  if (!la || !lb) return 2
  return Math.abs(la.family - lb.family) + 0.33 * Math.abs(la.step - lb.step)
}
