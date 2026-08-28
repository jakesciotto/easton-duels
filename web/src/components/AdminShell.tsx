import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { clearAdminToken } from '@/lib/auth'
import { Button } from '@/components/ui/button'

export function AdminShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b bg-background/90 px-6 py-3 backdrop-blur">
        <Link to="/admin" className="font-bold">Easton Duels</Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button variant="ghost" size="sm" onClick={clearAdminToken}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  )
}
