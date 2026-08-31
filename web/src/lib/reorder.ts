export function moveId(ids: number[], from: number, to: number): number[] {
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return [...ids]
  if (from === to) return [...ids]
  const next = [...ids]
  const [id] = next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
