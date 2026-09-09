import type { AthleteRow, EventDetail } from '@/lib/types'
import { athleteName, beltLabel, timeOfDay } from '@/lib/format'
import { TeamPlate } from '@/components/TeamPlate'
import { dialogBody, dialogFooter, dialogSurface } from '@/components/dialog-frame'
import { Button } from '@/components/ui/button'
import { List, ListRow } from '@/components/ui/list'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export const NOTHING_CHANGED = 'Nothing changed.'

// Label, then value, on two fixed tracks so every value starts on one edge down the
// sheet, which is what makes it scannable.
const ROW = 'grid grid-cols-[128px_minmax(0,1fr)] items-baseline gap-3'

const CHANGE_LABEL: Record<string, string> = {
  belt: 'Belt',
  erp: 'ERP',
  age: 'Age',
  weightLbs: 'Weight',
  gender: 'Gender',
  wlLocation: 'Location',
  promotedAt: 'Promoted',
  // The sync writes this one when a linked competitor is no longer in the pool.
  pool: 'Pool',
}

const changed = (v: unknown): string => (v === null || v === undefined ? 'none' : String(v))

/**
 * What the last sync did to this row, as a sentence. The values are the stored ones and
 * not the display ones: this line reports a write, so it has to name what was written.
 */
export function changeSentence(changes: Record<string, { from: unknown; to: unknown }> | null): string {
  const fields = Object.entries(changes ?? {})
  if (fields.length === 0) return NOTHING_CHANGED
  return fields.map(([key, d]) => `${CHANGE_LABEL[key] ?? key} ${changed(d.from)} to ${changed(d.to)}.`).join(' ')
}

const SOURCE_WORD: Record<string, string> = {
  manual: 'typed',
  leaderboard: 'leaderboard',
  wl: 'WellnessLiving',
}

/** A number is only half the fact. Where it came from decides whether it can be trusted. */
function measured(value: number | null, source: string | null): string {
  if (value === null) return 'missing'
  const word = source === null ? null : SOURCE_WORD[source] ?? null
  return word === null ? String(value) : `${value}, ${word}`
}

function beltRow(kid: AthleteRow): string {
  if (kid.belt === null) return beltLabel(null)
  return `${beltLabel(kid.belt)}, ${kid.promotedAt === null ? 'date unknown' : `since ${kid.promotedAt}`}`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <ListRow className={ROW}>
      <span className="t2 text-gray-10">{label}</span>
      <span className="t3 text-gray-12">{value}</span>
    </ListRow>
  )
}

/**
 * Everything the app holds about one competitor, read only, on the same surface the
 * match history uses. It answers the question the roster row cannot: where a number came
 * from, when the gym last promoted this child, and what the last sync moved.
 */
export function ProfileSheet({ detail, kid, open, onOpenChange }: {
  detail: EventDetail
  kid: AthleteRow | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  if (kid === null) return null
  const team = detail.teams.find(t => t.id === kid.teamId) ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogSurface(512)}>
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-3">
            <DialogTitle>{athleteName(kid)}</DialogTitle>
            {team !== null && <TeamPlate color={team.color} name={team.name} />}
          </div>
        </DialogHeader>
        <DialogBody className={dialogBody}>
          <List>
            <Row label="Location" value={kid.wlLocation ?? 'Unknown'} />
            <Row label="Belt" value={beltRow(kid)} />
            <Row label="ERP" value={kid.erp === null ? 'unrated' : kid.erp.toFixed(1)} />
            <Row label="Age" value={measured(kid.age, kid.ageSource)} />
            <Row label="Weight" value={measured(kid.weightLbs, kid.weightSource)} />
            <Row label="Gender" value={kid.gender ?? 'Unknown'} />
            <Row label="WellnessLiving" value={kid.wlUid === null ? 'Not linked' : 'Linked'} />
            <Row label="Last synced" value={timeOfDay(kid.syncedAt) ?? 'Never'} />
            <Row label="Last sync changed" value={changeSentence(kid.syncChanges)} />
          </List>
        </DialogBody>
        <DialogFooter className={dialogFooter}>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
