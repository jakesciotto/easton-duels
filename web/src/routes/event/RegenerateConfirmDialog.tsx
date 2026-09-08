import { writeErrorMessage } from '@/lib/eventMode'
import { regenerateWarning } from './matches-view'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * 6.8's one piece of friction, in one place. Regenerate is the only control in the app that
 * silently discards work an operator did by hand, so it states the figure it is about to
 * throw away. The Matches tab and the setup step both run the same mutation, so they ask
 * the same question in the same words rather than drifting into two accounts of what
 * Regenerate does.
 */
export function RegenerateConfirmDialog({ open, pendingCount, handCount, pending, error, onOpenChange, onConfirm }: {
  open: boolean
  pendingCount: number
  handCount: number
  pending: boolean
  error: Error | null
  onOpenChange: (o: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replace {pendingCount} pending {pendingCount === 1 ? 'match' : 'matches'}?</DialogTitle></DialogHeader>
        <DialogBody>
          <p className="t3 text-gray-11">{regenerateWarning(pendingCount, handCount)}</p>
          <p className="t3 text-gray-11">Manually added or edited pending matches are replaced too. Live and done matches are not affected.</p>
          {error && (
            <Alert>
              <AlertTitle>The matchups did not generate</AlertTitle>
              <AlertDescription>{writeErrorMessage(error)}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" size="lg" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" size="lg" variant="destructive" disabled={pending} onClick={onConfirm}>Regenerate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
