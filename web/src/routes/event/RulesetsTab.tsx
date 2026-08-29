import type { EventDetail } from '@/lib/types'

export function RulesetsTab({ detail }: { detail: EventDetail }) {
  return <p className="text-faint">Rulesets for {detail.event.name} arrive in a later task.</p>
}
