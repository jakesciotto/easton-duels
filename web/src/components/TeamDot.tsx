import { teamHex } from '@/lib/format'

export function TeamDot({ color, name }: { color: string; name?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block size-3 rounded-full" style={{ background: teamHex(color) }} aria-hidden />
      {name && <span>{name}</span>}
    </span>
  )
}
