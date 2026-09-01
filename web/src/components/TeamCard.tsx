import type { ReactNode } from 'react'
import { TeamDot } from '@/components/TeamDot'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function TeamCard({ color, name, role, className, children }: {
  color: string
  name: string
  role?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <TeamDot color={color} name={name} />
        {role && <span className="ml-auto shrink-0 t1 text-gray-10">{role}</span>}
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
    </Card>
  )
}
