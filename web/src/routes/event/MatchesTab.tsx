import type { EventDetail } from '@/lib/types'

export function MatchesTab({ detail }: { detail: EventDetail }) {
  return <p className="text-faint">Matches for {detail.event.name} arrive in a later task.</p>
}
