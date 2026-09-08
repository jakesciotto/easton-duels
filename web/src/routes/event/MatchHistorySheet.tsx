import { useEffect, useState } from 'react'
import type { AuditEntry } from '@shared/types'
import { adminApi } from '@/lib/queries'
import { historyRows, type HistoryRow, type HistorySource } from './match-history'
import { cn } from '@/lib/utils'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { List, ListRow } from '@/components/ui/list'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export const HISTORY_NOTE = 'Every recorded action, oldest first. Read only.'
export const HISTORY_EMPTY = 'Nothing has been recorded here yet.'

// Time, who, what changed. The first two are fixed tracks so the words in the third
// column start on one edge down the whole sheet, which is what makes it scannable.
const ROW = 'grid grid-cols-[64px_72px_minmax(0,1fr)] items-baseline gap-3'

// 7.11: a skeleton is sized to the content it replaces, so the sheet does not resize
// under the reader when the rows land.
function LoadingRows() {
  return (
    <List aria-hidden>
      {[0, 1, 2, 3].map(i => (
        <ListRow key={i} className={ROW}>
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-40" />
        </ListRow>
      ))}
    </List>
  )
}

function Row({ row }: { row: HistoryRow }) {
  return (
    <ListRow className={ROW}>
      <span className="fig t2 text-gray-10">{row.time}</span>
      <span className={cn('t1 uppercase', row.fromMat ? 'text-gray-11' : 'text-gray-10')}>{row.who}</span>
      <span className="grid min-w-0 gap-0.5">
        {/* An undone action keeps its words and loses its weight: nothing is erased. */}
        <span className={cn('t3', row.undone !== null && 'text-gray-10')}>{row.what}</span>
        {row.detail !== null && <span className="t2 text-gray-10">{row.detail}</span>}
        {row.undone !== null && <span className="t2 text-gray-10">{row.undone}</span>}
      </span>
    </ListRow>
  )
}

/**
 * The audit trail for one match, or for the event, read only.
 *
 * It fetches on every open rather than caching: the log only grows, and an organizer
 * opening it a second time is doing so because something has happened since.
 */
export function MatchHistorySheet({ source, open, onOpenChange }: {
  source: HistorySource | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const path = open && source !== null ? source.path : null

  useEffect(() => {
    if (path === null) return
    let ignore = false
    setEntries(null)
    setError(null)
    adminApi<AuditEntry[]>(path)
      .then(rows => { if (!ignore) setEntries(rows) })
      .catch((e: Error) => { if (!ignore) setError(e) })
    return () => { ignore = true }
  }, [path])

  if (source === null) return null
  const rows = entries === null ? [] : historyRows(entries, source.context)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(512)}>
        <DialogHeader>
          <div className="grid min-w-0 gap-0.5">
            <DialogTitle>{source.title}</DialogTitle>
            <DialogDescription className="t2 text-gray-10">{HISTORY_NOTE}</DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className={dialogBody}>
          {error !== null && (
            <Alert>
              <AlertTitle>The history did not load</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          {error === null && entries === null && <LoadingRows />}
          {error === null && entries !== null && (
            <List>
              {rows.length === 0
                ? <EmptyState message={HISTORY_EMPTY} />
                : rows.map(row => <Row key={row.id} row={row} />)}
            </List>
          )}
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
