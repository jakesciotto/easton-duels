import { KIDS_BELTS } from '../shared/types.js'

export const EXCLUDED = 1e6

export interface Constraints { maxAgeGap: number; maxWeightGap: number; sameGender: boolean }

export interface Matchable {
  id: number
  age: number | null
  weightLbs: number | null
  belt: string | null
  gender: string | null
  erp: number | null
}

const FAMILY: Record<string, number> = { white: 0, grey: 1, yellow: 2, orange: 3, green: 4 }

function ladder(belt: string | null): { family: number; step: number } | null {
  if (!belt || !(KIDS_BELTS as readonly string[]).includes(belt)) return null
  const [family, stripe] = belt.split('-')
  return { family: FAMILY[family], step: stripe === 'white' ? 0 : stripe === 'black' ? 2 : 1 }
}

export function beltDistance(a: string | null, b: string | null): number {
  const la = ladder(a)
  const lb = ladder(b)
  if (!la || !lb) return 2
  return Math.abs(la.family - lb.family) + 0.33 * Math.abs(la.step - lb.step)
}

const genderKey = (g: string) => g.trim().toLowerCase().charAt(0)

export function pairCost(a: Matchable, b: Matchable, c: Constraints): { cost: number; why: string } {
  if (a.age === null || b.age === null || a.weightLbs === null || b.weightLbs === null) return { cost: EXCLUDED, why: 'missing age or weight' }
  const ageGap = Math.abs(a.age - b.age)
  const weightGap = Math.abs(a.weightLbs - b.weightLbs)
  if (ageGap > c.maxAgeGap) return { cost: EXCLUDED, why: `age gap ${ageGap}` }
  if (weightGap > c.maxWeightGap) return { cost: EXCLUDED, why: `weight gap ${weightGap}` }
  if (c.sameGender && a.gender && b.gender && genderKey(a.gender) !== genderKey(b.gender)) return { cost: EXCLUDED, why: 'gender' }
  if (a.erp !== null && b.erp !== null) return { cost: Math.abs(a.erp - b.erp), why: `ERP ${a.erp.toFixed(1)} vs ${b.erp.toFixed(1)}` }
  return { cost: beltDistance(a.belt, b.belt) + ageGap * 0.5 + weightGap / 10, why: 'belt + age + weight' }
}
