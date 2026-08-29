import type { WinType } from '@shared/types'

export function defaultOutcome(pointsA: number, pointsB: number): { winner: 'a' | 'b' | null; winType: WinType } {
  if (pointsA > pointsB) return { winner: 'a', winType: 'points' }
  if (pointsB > pointsA) return { winner: 'b', winType: 'points' }
  return { winner: null, winType: 'decision' }
}
