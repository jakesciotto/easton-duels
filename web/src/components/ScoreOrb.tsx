import type { ReactNode } from 'react'
import { teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ScoreOrb({ color, size = 44, className, children }: {
  color: string
  size?: number
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn('team-grad inline-grid shrink-0 place-items-center rounded-full font-mono text-[19px] font-bold tabular-nums text-white', className)}
      style={{ ...teamStyle(color), width: size, height: size }}
    >
      {children}
    </span>
  )
}
