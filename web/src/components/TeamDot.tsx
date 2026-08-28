import { teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'

export function TeamDot({ color, name, size = 8, className }: {
  color: string
  name?: string
  size?: number | string
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 font-medium', className)}>
      <span aria-hidden className="team-dot shrink-0 rounded-full" style={{ ...teamStyle(color), width: size, height: size }} />
      {name && <span className="truncate">{name}</span>}
    </span>
  )
}
