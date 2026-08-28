import type { ReactNode } from 'react'
import { ColourOrb } from '@/components/ColourOrb'
import { teamStyle } from '@/lib/format'
import { cn } from '@/lib/utils'

export function TeamCard({ color, name, role, className, children }: {
  color: string
  name: string
  role: string
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn('team-tint grid gap-3 rounded-2xl border p-3.5', className)} style={teamStyle(color)}>
      <div className="flex items-center gap-2.5">
        <ColourOrb color={color} size={30} />
        {name && <span className="display truncate text-[17px]">{name}</span>}
        <span className="ml-auto shrink-0 text-xs text-faint">{role}</span>
      </div>
      {children}
    </div>
  )
}
