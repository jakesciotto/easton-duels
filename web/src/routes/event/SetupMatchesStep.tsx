import { useEffect, useMemo, useState } from 'react'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { useSnapshot } from '@/lib/useSnapshot'
import { writeErrorMessage } from '@/lib/eventMode'
import type { EventDetail } from '@/lib/types'
import { cn } from '@/lib/utils'
import { SetupSteps } from '@/components/SetupSteps'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RegenerateConfirmDialog } from './RegenerateConfirmDialog'
import { matchLines, regenerateBlockedReason } from './matches-view'

interface GenerateResult { created: number; unpairedA: number[]; unpairedB: number[] }

export function generatedLine(r: GenerateResult): string {
  return `${r.created} matches created, ${r.unpairedA.length + r.unpairedB.length} unpaired`
}

/**
 * Step three. The matchmaker is the reason this product exists and it sat behind a tab with
 * a button called Generate, which an organizer setting up their first event had no reason
 * to press or even to find. The step runs the same mutation the Matches tab runs, against
 * the same refusal and the same confirm, and then hands the event over.
 */
export function SetupMatchesStep({ detail, open, onClose }: {
  detail: EventDetail
  open: boolean
  onClose: () => void
}) {
  const eventId = detail.event.id
  // No pinned interval: this mounts inside the event body's stream, which polls on the
  // derived ramp.
  const { snapshot } = useSnapshot(eventId)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const generate = useAdminMutation(eventId, () => adminApi<GenerateResult>(`/api/events/${eventId}/matches/generate`, { method: 'POST' }))

  const lines = useMemo(() => matchLines(detail, snapshot), [detail, snapshot])
  const live = useMemo(() => lines.filter(l => l.lane === 'live'), [lines])
  const pendingCount = lines.filter(l => l.lane === 'pending').length
  // Refuse rather than ask (6.8): Regenerate deletes the whole pending queue, including the
  // row a running mat is about to call.
  const blocked = regenerateBlockedReason(live)

  // A step reopened from the URL after a reload describes the event it is looking at now,
  // not the run it made before the page went away.
  useEffect(() => {
    if (open) return
    setConfirmOpen(false)
    setResult(null)
    generate.reset()
  }, [open])

  const run = () => {
    generate.mutate(undefined, {
      onSuccess: r => {
        setResult(generatedLine(r))
        setConfirmOpen(false)
      },
    })
  }
  const onGenerate = () => {
    if (blocked !== null) return
    // A second press would throw away a queue somebody may have ordered by hand, so it
    // asks in the same words the Matches tab asks in.
    if (pendingCount > 0) { setConfirmOpen(true); return }
    run()
  }

  const competitors = detail.athletes.length
  const mats = detail.mats.length
  // While the confirm is open the failure belongs to the control inside it.
  const error = confirmOpen ? null : generate.error

  return (
    <>
      <Dialog open={open && !confirmOpen} onOpenChange={o => { if (!o) onClose() }}>
        <DialogContent className={dialogSurface(576)}>
          <DialogHeader>
            <div className="grid gap-1">
              <DialogTitle>Assign the matches</DialogTitle>
              <SetupSteps current={3} />
            </div>
          </DialogHeader>
          <DialogBody className={dialogBody}>
            <p className="t3 text-gray-11">
              <span className="fig">{competitors}</span> {competitors === 1 ? 'competitor' : 'competitors'} across{' '}
              <span className="fig">{mats}</span> {mats === 1 ? 'mat' : 'mats'}. Generate matchups pairs them by rating,
              belt, age and weight, and you can move any pair on the Matches tab afterwards.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" disabled={generate.isPending || blocked !== null} onClick={onGenerate}>
                Generate matchups
              </Button>
              {blocked !== null && <span className="t2 text-gray-10">{blocked}</span>}
              {/* 7.12: one polite region, in the DOM and empty from the first render. */}
              <span aria-live="polite" className="t2 text-gray-10">{result ?? ''}</span>
            </div>
            {error && (
              <Alert>
                <AlertTitle>The matchups did not generate</AlertTitle>
                <AlertDescription>{writeErrorMessage(error)}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter className={cn(dialogFooter, 'justify-between')}>
            <Button type="button" variant="ghost" onClick={onClose}>Skip for now</Button>
            <Button type="button" onClick={onClose}>Open the event</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RegenerateConfirmDialog
        open={open && confirmOpen}
        pendingCount={pendingCount}
        handCount={0}
        pending={generate.isPending}
        error={generate.error}
        onOpenChange={o => { if (!o) { setConfirmOpen(false); generate.reset() } }}
        onConfirm={run}
      />
    </>
  )
}
