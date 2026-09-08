// Newest finish first. A match without an endedAt (finished before the field existed)
// sorts after every match that has one, tie broken by id descending either way.
//
// One definition for every surface that prints finished matches. The Entry ledger sorted
// by id instead, so a result entered against a match the designer had already laid out
// landed in the middle of a list whose head says newest first, and the row's own arrival
// highlight fired off screen.
export function sortDoneMatches<T extends { id: number; endedAt?: string | null }>(matches: readonly T[]): T[] {
  return [...matches].sort((x, y) => {
    const xa = x.endedAt ?? null
    const ya = y.endedAt ?? null
    if (xa === null && ya === null) return y.id - x.id
    if (xa === null) return 1
    if (ya === null) return -1
    if (xa !== ya) return xa < ya ? 1 : -1
    return y.id - x.id
  })
}
