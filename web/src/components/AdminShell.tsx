import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { clearAdminToken } from '@/lib/auth'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'

export function AdminShell({ title, status, actions, children }: {
  title: string
  status?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-background px-6 py-3">
        <Link to="/admin" className="rounded-md outline-none focus-visible:shadow-focus"><Wordmark /></Link>
        <span aria-hidden className="text-[#42434d]">/</span>
        <h1 className="truncate font-medium text-[#d9d9de]">{title}</h1>
        {status}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button variant="ghost" size="sm" onClick={clearAdminToken}>Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  )
}
