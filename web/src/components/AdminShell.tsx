import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { clearAdminToken } from '@/lib/auth'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'

export function AdminShell({ title, status, actions, meta, children }: {
  title: string
  status?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-background py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6">
          <Link to="/admin" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:shadow-focus">
            <img src="/easton-logo.png" alt="Easton Training Center" width={24} height={24} className="size-6 shrink-0 rounded-full" />
            <Wordmark />
          </Link>
          <span aria-hidden className="text-[#42434d]">/</span>
          <span className="truncate font-medium text-[#d9d9de]">{title}</span>
          {status}
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <Button variant="ghost" size="sm" onClick={clearAdminToken}>Sign out</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl text-sm">
        <div className="grid gap-2 px-6 pt-6 pb-4">
          <h1 className="truncate text-[22px] font-semibold tracking-[-0.035em]">{title}</h1>
          {meta}
        </div>
        {children}
      </main>
    </div>
  )
}
