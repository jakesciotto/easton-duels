import type { EventDetail } from '@/lib/types'

export function EntryTab({ detail }: { detail: EventDetail }) {
  return <p className="text-faint">Entry for {detail.event.name} arrives in a later task.</p>
}
