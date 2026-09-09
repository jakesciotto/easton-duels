/** Lowercase, letters and digits only. The common ground every comparison runs on. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function bigrams(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

/**
 * Dice coefficient over character bigrams of the normalized strings, 0 to 1. A string
 * under two characters has no bigram, so the answer is 1 for an equal pair and 0
 * otherwise.
 */
export function dice(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 1
  if (na.length < 2 || nb.length < 2) return 0

  const bgA = bigrams(na)
  const bgB = bigrams(nb)
  const pool = [...bgB]
  let matches = 0
  for (const bg of bgA) {
    const i = pool.indexOf(bg)
    if (i === -1) continue
    matches++
    pool.splice(i, 1)
  }
  return (2 * matches) / (bgA.length + bgB.length)
}
