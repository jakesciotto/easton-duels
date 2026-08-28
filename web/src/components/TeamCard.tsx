import type { ReactNode } from 'react'
import { TeamDot } from '@/components/TeamDot'
import { cn } from '@/lib/utils'

export function TeamCard({ color, name, role, className, children }: {
  color: string
  name: string
  role: string
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn('grid gap-2.5 rounded-lg border border-border bg-card p-3', className)}>
      <div className="flex items-center gap-2">
        <TeamDot color={color} name={name} />
        <span className="ml-auto shrink-0 text-xs text-faint">{role}</span>
      </div>
      {children}
    </div>
  )
}
