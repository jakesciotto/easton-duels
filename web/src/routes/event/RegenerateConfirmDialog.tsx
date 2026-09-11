import { writeErrorMessage } from '@/lib/eventMode'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * 6.8's one piece of friction, in one place. Proposing again deletes every draft on the
 * event, the ones an organizer has already swapped by hand included, so it states the
 * figure it is about to throw away. It is asked only when drafts exist: the first press
 * has nothing to replace.
 */
export function RegenerateConfirmDialog({ open, count, pending, error, onOpenChange, onConfirm }: {
  open: boolean
  count: number
  pending: boolean
  error: Error | null
  onOpenChange: (o: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replace {count} {count === 1 ? 'proposal' : 'proposals'}?</DialogTitle></DialogHeader>
        <DialogBody>
          <p className="t3 text-gray-11">Proposing again replaces every proposal on this event, the swaps you made by hand included.</p>
          <p className="t3 text-gray-11">Matches you have already confirmed are not affected.</p>
          {error && (
            <Alert>
              <AlertTitle>The proposals did not come back</AlertTitle>
              <AlertDescription>{writeErrorMessage(error)}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" size="lg" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" size="lg" disabled={pending} onClick={onConfirm}>Propose more</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
