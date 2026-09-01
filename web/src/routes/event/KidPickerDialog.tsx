import { useState } from 'react'
import type { EventDetail } from '@/lib/types'
import { athleteName, beltLabel } from '@/lib/format'
import { isDoubleBooked } from '@/lib/doubleBooking'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { List, ListRow } from '@/components/ui/list'

export function KidPickerDialog({ detail, teamId, matchId, open, onOpenChange, onPick }: {
  detail: EventDetail; teamId: number | null; matchId: number | null; open: boolean
  onOpenChange: (o: boolean) => void; onPick: (athleteId: number) => void
}) {
  const [search, setSearch] = useState('')
  const team = detail.teams.find(t => t.id === teamId)
  const kids = detail.athletes
    .filter(a => a.teamId === teamId && athleteName(a).toLowerCase().includes(search.toLowerCase()))
    .sort((x, y) => x.lastName.localeCompare(y.lastName))

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setSearch('') }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Pick a {team?.name ?? ''} competitor</DialogTitle></DialogHeader>
        <DialogBody>
          <Input aria-label="Search competitors" autoFocus value={search} onChange={e => setSearch(e.target.value)} />
          <List className="max-h-80 overflow-y-auto">
            {kids.length === 0
              ? <ListRow className="text-sm text-gray-10">No competitors match</ListRow>
              : kids.map(k => (
                <ListRow key={k.id} className="p-0">
                  <button
                    type="button"
                    aria-label={athleteName(k)}
                    onClick={() => { onPick(k.id); onOpenChange(false); setSearch('') }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm outline-none transition-colors duration-150 hover:bg-accent focus-visible:shadow-focus"
                  >
                    <span className="flex-1 truncate font-medium">{athleteName(k)}</span>
                    {isDoubleBooked(k.id, detail.matches, matchId ?? undefined) && <Badge variant="warn">double-booked</Badge>}
                    <span className="text-gray-10">{beltLabel(k.belt)}</span>
                    <span className="font-mono tabular text-gray-10">{k.age ?? '?'}y {k.weightLbs ?? '?'}lb</span>
                    {k.erp !== null && <span className="font-mono tabular text-gray-10">ERP {k.erp.toFixed(1)}</span>}
                  </button>
                </ListRow>
              ))}
          </List>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
