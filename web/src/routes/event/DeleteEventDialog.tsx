import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { writeErrorMessage } from '@/lib/eventMode'
import { adminApi, qk } from '@/lib/queries'
import type { EventDetail } from '@/lib/types'
import { CodeField } from '@/components/CodeField'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export const DELETE_EVENT_TITLE = 'Delete this event?'
export const DELETE_EVENT_ACTION = 'Delete event'
export const DELETE_EVENT_PIN_LABEL = 'Enter the PIN to delete an event with results'

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/**
 * What the delete takes, in the numbers the organizer already has on the strip above.
 * A confirm that says only "this cannot be undone" is a confirm nobody can weigh: the
 * whole question is whether this is the empty event from last week or the one that ran.
 */
export function deleteConsequence(detail: EventDetail): string {
  const results = detail.matches.filter(m => m.status === 'done').length
  const what = [
    count(detail.athletes.length, 'competitor', 'competitors'),
    count(detail.matches.length, 'match', 'matches'),
    count(results, 'result', 'results'),
  ].join(', ')
  return `${detail.event.name}, ${detail.event.date}: ${what}. This cannot be undone.`
}

/**
 * Spec 3.2. An event that never left setup deletes on a plain confirm, because there is
 * nothing to lose but the typing. An event that started asks for the PIN again, and the
 * field is the one the Unlock dialog uses so the desk types the same six wells for both
 * of the destructive paths on the record.
 *
 * A certified event never reaches here: the overflow item is dead and the way out is the
 * Live tab's Unlock.
 */
export function DeleteEventDialog({ detail, open, onOpenChange }: {
  detail: EventDetail
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const eventId = detail.event.id
  const needsPin = detail.event.status !== 'setup'
  const [pin, setPin] = useState('')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: (body: { pin?: string }) => adminApi(`/api/events/${eventId}`, { method: 'DELETE', body }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.events })
      onOpenChange(false)
      navigate('/admin')
    },
  })

  useEffect(() => {
    if (!open) return
    setPin('')
    del.reset()
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(512)}>
        <DialogHeader><DialogTitle>{DELETE_EVENT_TITLE}</DialogTitle></DialogHeader>
        <DialogBody className={dialogBody}>
          <p className="t2 text-gray-11">{deleteConsequence(detail)}</p>
          {needsPin && (
            <div className="grid gap-1.5">
              <Label htmlFor="delete-event-pin">{DELETE_EVENT_PIN_LABEL}</Label>
              <CodeField id="delete-event-pin" length={6} aria-label="Admin PIN" value={pin} onValueChange={setPin} autoFocus />
            </div>
          )}
          {/* A refusal is read where it was asked for, never on the shell behind. */}
          {del.error && (
            <Alert>
              <AlertTitle>This event was not deleted</AlertTitle>
              <AlertDescription>{writeErrorMessage(del.error)}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            variant="destructive"
            disabled={del.isPending || (needsPin && pin.length !== 6)}
            onClick={() => del.mutate(needsPin ? { pin } : {})}
          >
            {DELETE_EVENT_ACTION}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
