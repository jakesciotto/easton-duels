import { useState } from 'react'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { TEAM_COLOR_KEYS, TEAM_COLOR_LABELS, teamCode, type TeamColor } from '@shared/types'
import { teamStyle } from '@/lib/format'
import { colourVerdict, freeColors, nextColor, type GuardLevel } from '@/lib/team-guard'
import { cn } from '@/lib/utils'
import { TeamPlate } from '@/components/TeamPlate'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface TeamDraft {
  /** Present once the team is a row on the server, absent while it is still a draft. */
  id?: number
  name: string
  color: TeamColor
}

export const MIN_TEAMS = 2
export const MAX_TEAMS = 8

export const AT_MOST = 'An event holds at most eight teams.'
export const AT_LEAST = 'An event holds at least two teams.'

const colorsOf = (teams: TeamDraft[], except = -1) => teams.filter((_, i) => i !== except).map(t => t.color)

/**
 * 2.4's two guards, enforced from the tables rather than from memory, and against every
 * other team on the event rather than one opponent. A colour another team holds is not on
 * the grid at all; one that would read as another team's is offered at 40 percent with
 * `aria-disabled` and refused with the reason named, because a swatch that silently does
 * nothing teaches nothing.
 */
function ColourGrid({ value, taken, label, onChange }: {
  value: TeamColor
  taken: TeamColor[]
  label: string
  onChange: (c: TeamColor) => void
}) {
  const [refused, setRefused] = useState<TeamColor | null>(null)
  const offered = TEAM_COLOR_KEYS.filter(c => c === value || !taken.includes(c))
  const verdicts = new Map(offered.map(c => [c, colourVerdict(c, taken)]))
  /**
   * Eight hues spread 45 degrees apart cannot all clear a 60 degree floor, so past three
   * or four teams every remaining colour reads as one already in use. A guard that leaves
   * nothing to pick cannot refuse: it states the problem and lets the organizer keep the
   * event, which is the same call spec 8 makes about a hand designed pair.
   */
  const anyLegal = offered.some(c => verdicts.get(c)?.level !== 'block')
  const levelOf = (c: TeamColor): GuardLevel => {
    const level = verdicts.get(c)?.level ?? 'ok'
    return !anyLegal && level === 'block' ? 'warn' : level
  }
  const shown = refused !== null && levelOf(refused) === 'block' ? refused : levelOf(value) !== 'ok' ? value : null

  return (
    <div className="grid gap-2">
      <RadioGroup
        value={value}
        aria-label={label}
        onValueChange={v => {
          const next = v as TeamColor
          if (levelOf(next) === 'block') return setRefused(next)
          setRefused(null)
          onChange(next)
        }}
        className="flex flex-wrap gap-2"
      >
        {offered.map(c => (
          <Radio.Root
            key={c}
            value={c}
            aria-label={TEAM_COLOR_LABELS[c]}
            aria-disabled={levelOf(c) === 'block' || undefined}
            style={teamStyle(c)}
            className={cn(
              'team-dot size-[18px] rounded-full outline-none transition-opacity duration-150 ease-standard focus-visible:shadow-focus data-checked:ring-[1.5px] data-checked:ring-primary data-checked:ring-offset-2 data-checked:ring-offset-card',
              levelOf(c) === 'block' && 'opacity-40',
            )}
          />
        ))}
      </RadioGroup>
      {shown !== null && <p className="t2 text-gray-10">{verdicts.get(shown)?.reason}</p>}
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="grid content-start gap-3 bg-gray-1 p-4">{children}</div>
}

/**
 * The one team list, in the New event dialog where the rows are still a draft and in the
 * event settings where they are rows on the server. Both add through the same draft row,
 * so an organizer learns one control and the two screens cannot drift into two accounts
 * of what a team is.
 */
export function TeamList({ teams, locked = false, pending = false, error = null, onChange, onAdd, onRemove }: {
  teams: TeamDraft[]
  /** True where the rows already exist on the server: they are added and removed, not retyped. */
  locked?: boolean
  pending?: boolean
  error?: string | null
  onChange: (index: number, next: TeamDraft) => void
  onAdd: (team: TeamDraft) => void
  onRemove: (index: number) => void
}) {
  const [draft, setDraft] = useState<TeamDraft | null>(null)
  // The draft row closes when the team it made lands, which is the same signal whether the
  // caller appended it here or the server answered and the event refetched.
  const [count, setCount] = useState(teams.length)
  if (count !== teams.length) {
    setCount(teams.length)
    if (teams.length > count) setDraft(null)
  }

  const atFloor = teams.length <= MIN_TEAMS
  const ready = draft !== null && draft.name.trim() !== ''
  const submitDraft = () => { if (ready && draft) onAdd({ name: draft.name.trim(), color: draft.color }) }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {teams.map((team, i) => {
          const role = `Team ${i + 1}`
          const label = team.name || role
          const taken = colorsOf(teams, i)
          const remove = (
            <Button
              type="button" variant="ghost" size="sm" className="ml-auto shrink-0"
              aria-label={`Remove ${label}`}
              title={atFloor ? AT_LEAST : undefined}
              disabled={atFloor || pending}
              onClick={() => onRemove(i)}
            >
              Remove
            </Button>
          )
          if (locked) {
            return (
              <Panel key={team.id ?? i}>
                <div className="flex min-w-0 items-center gap-3">
                  <TeamPlate color={team.color} name={label} />
                  {remove}
                </div>
              </Panel>
            )
          }
          return (
            <Panel key={team.id ?? i}>
              <div className="flex min-w-0 items-center gap-3">
                <TeamPlate color={team.color} name={label} />
                {remove}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`team-${i}`}>{role} name</Label>
                <Input id={`team-${i}`} required value={team.name} onChange={e => onChange(i, { ...team, name: e.target.value })} />
              </div>
              <p className="t1 text-gray-10">
                Board code <span className="fig fig-3 text-gray-11">{teamCode(label)}</span>
              </p>
              <ColourGrid value={team.color} taken={taken} label={`${role} colour`} onChange={color => onChange(i, { ...team, color })} />
            </Panel>
          )
        })}

        {draft !== null && (
          <Panel>
            <div className="flex min-w-0 items-center gap-3">
              <TeamPlate color={draft.color} name={draft.name || 'New team'} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="team-new">New team name</Label>
              <Input
                id="team-new"
                autoFocus
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                // This list sits inside the New event form, where a bare Enter would
                // create the event and leave the team nobody added behind.
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitDraft() } }}
              />
            </div>
            <ColourGrid
              value={draft.color} taken={colorsOf(teams)} label="New team colour"
              onChange={color => setDraft({ ...draft, color })}
            />
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" disabled={!ready || pending} onClick={submitDraft}>Add team</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </Panel>
        )}
      </div>

      {draft === null && (
        teams.length < MAX_TEAMS
          ? <Button type="button" size="sm" variant="secondary" className="justify-self-start" disabled={pending} onClick={() => setDraft({ name: '', color: nextColor(colorsOf(teams)) })}>Add a team</Button>
          : <span className="t2 text-gray-10">{AT_MOST}</span>
      )}

      {error !== null && (
        <Alert>
          <AlertTitle>That team list did not change</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

export { freeColors }
