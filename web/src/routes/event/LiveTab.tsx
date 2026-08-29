import type { EventDetail } from '@/lib/types'

export function LiveTab({ detail }: { detail: EventDetail }) {
  return <p className="text-faint">Live board controls for {detail.event.name} arrive in a later task.</p>
}
