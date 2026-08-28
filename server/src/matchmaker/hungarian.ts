export const PAD = 1e6

// Kuhn-Munkres with potentials on a rectangular matrix padded to a square.
// Returns the assigned column for each row, or -1. Padded cells cost PAD, so a
// caller that also uses PAD for excluded pairs can drop every assignment at or
// above PAD and get an optimal matching of the remaining pairs.
export function solveAssignment(cost: number[][]): number[] {
  const n = cost.length
  const m = n === 0 ? 0 : Math.max(...cost.map(r => r.length))
  if (n === 0 || m === 0) return new Array<number>(n).fill(-1)
  const size = Math.max(n, m)
  const a = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => cost[i]?.[j] ?? PAD))
  const u = new Array<number>(size + 1).fill(0)
  const v = new Array<number>(size + 1).fill(0)
  const p = new Array<number>(size + 1).fill(0)
  const way = new Array<number>(size + 1).fill(0)

  for (let i = 1; i <= size; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array<number>(size + 1).fill(Number.POSITIVE_INFINITY)
    const used = new Array<boolean>(size + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Number.POSITIVE_INFINITY
      let j1 = 0
      for (let j = 1; j <= size; j++) {
        if (used[j]) continue
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0 !== 0)
  }

  const result = new Array<number>(n).fill(-1)
  for (let j = 1; j <= size; j++) {
    const i = p[j]
    if (i >= 1 && i <= n && j <= m && j - 1 < cost[i - 1].length) result[i - 1] = j - 1
  }
  return result
}
