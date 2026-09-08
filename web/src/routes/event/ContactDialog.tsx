import { useEffect, useState, type FormEvent } from 'react'
import { writeErrorMessage } from '@/lib/eventMode'
import { adminApi, useAdminMutation } from '@/lib/queries'
import type { EventDetail } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { dialogBody, dialogFooter, dialogStack, dialogSurface } from '@/components/dialog-frame'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export const CONTACT_TITLE = 'Who do volunteers call?'

/**
 * 6.4's escalation contact, set after the event exists.
 *
 * The New event dialog asks for it once, on the morning nobody has decided yet who is
 * running the desk, so the only version of this field that gets filled in is the one an
 * organizer can reach from the event itself. Event-night volunteer practice requires
 * every volunteer to have a named person to escalate to or they simply stop working.
 *
 * Either half empty clears the line: a name with no number, or a number with no name,
 * gives a volunteer nothing to act on, and the server reads a blank string as a clear.
 */
export function ContactDialog({ open, onOpenChange, detail }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: EventDetail
}) {
  const eventId = detail.event.id
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const save = useAdminMutation(eventId, (body: { contactName: string; contactPhone: string }) =>
    adminApi(`/api/events/${eventId}`, { method: 'PATCH', body }))

  // Opening is the only thing that seeds the form, so a refetch landing behind the dialog
  // never overwrites what the organizer is halfway through typing.
  useEffect(() => {
    if (!open) return
    setName(detail.event.contact?.name ?? detail.event.contactName ?? '')
    setPhone(detail.event.contact?.phone ?? detail.event.contactPhone ?? '')
    save.reset()
  }, [open])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({ contactName: name.trim(), contactPhone: phone.trim() }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(512)}>
        <form onSubmit={submit} className={dialogStack}>
          <DialogHeader><DialogTitle>{CONTACT_TITLE}</DialogTitle></DialogHeader>
          <DialogBody className={dialogBody}>
            <div className="grid gap-4">
              <p className="t3 text-gray-11">
                The name and number go along the bottom of every screen, so a volunteer on a mat
                always has somebody to call.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="contact-name">Name</Label>
                <Input id="contact-name" value={name} maxLength={60} autoComplete="off" onChange={e => setName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contact-phone">Phone</Label>
                <Input
                  id="contact-phone"
                  value={phone}
                  maxLength={30}
                  inputMode="tel"
                  autoComplete="off"
                  onChange={e => setPhone(e.target.value)}
                  className="fig"
                />
              </div>
              <p className="t2 text-gray-10">Clear either field to take the line off the screens.</p>
              {save.error && (
                <Alert>
                  <AlertTitle>The contact was not saved</AlertTitle>
                  <AlertDescription>{writeErrorMessage(save.error)}</AlertDescription>
                </Alert>
              )}
            </div>
          </DialogBody>
          <DialogFooter className={dialogFooter}>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save contact</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** 6.4: "Questions at the desk: [organizer first name], [phone]." Null with no pair. */
export function contactFooter(detail: EventDetail): string | null {
  const contact = detail.event.contact
    ?? (detail.event.contactName && detail.event.contactPhone
      ? { name: detail.event.contactName, phone: detail.event.contactPhone }
      : null)
  return contact === null ? null : `Questions at the desk: ${contact.name}, ${contact.phone}.`
}
