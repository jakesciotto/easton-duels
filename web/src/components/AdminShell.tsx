import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { clearAdminToken } from '@/lib/auth'
import { Button } from '@/components/ui/button'

export function AdminShell({ title, status, actions, children }: {
  title: string
  status?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 flex items-center gap-5 border-b border-border bg-background px-7 py-4">
        <Link to="/admin" className="display bg-[linear-gradient(90deg,#ff7a7a,#5aa2ff)] bg-clip-text text-[22px] font-extrabold text-transparent">Duels</Link>
        <h1 className="display truncate text-lg">{title}</h1>
        {status}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button variant="outline" size="sm" onClick={clearAdminToken}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-7 py-6">{children}</main>
    </div>
  )
}
