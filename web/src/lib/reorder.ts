export function moveId(ids: number[], from: number, to: number): number[] {
  if (from === to) return [...ids]
  const next = [...ids]
  const [id] = next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
