import { useParams } from 'react-router'
import { useSnapshot } from '@/lib/useSnapshot'
import { teamStyle } from '@/lib/format'
import { Connecting } from '@/components/Connecting'
import { HeroScore } from './board/HeroScore'
import { MatTile } from './board/MatTile'
import { ResultTile } from './board/ResultTile'
import { OnDeckStrip } from './board/OnDeckStrip'
import { useRecentResults } from './board/useRecentResults'

export default function BoardPage() {
  const { eventId } = useParams()
  const { snapshot, connected } = useSnapshot(eventId ? Number(eventId) : null)
  const recent = useRecentResults(snapshot)

  if (!snapshot) {
    return (
      <main className="flex h-dvh flex-col bg-background">
        <Connecting connected={connected} />
        <div className="grid flex-1 place-items-center">
          <p className="text-[2vw] text-muted-foreground">Connecting to the board</p>
        </div>
      </main>
    )
  }

  const { event, teams, mats, matches } = snapshot
  const [a, b] = teams

  if (event.status === 'done') {
    const winner = a.wins === b.wins ? (a.points >= b.points ? a : b) : a.wins > b.wins ? a : b
    return (
      <main style={teamStyle(winner.color)} className="grid h-dvh place-items-center bg-background text-center">
        <div>
          <h1 className="text-[9vw] font-semibold tracking-[-0.035em] text-[var(--team)]">{winner.name} wins</h1>
          <p className="mt-[2vw] text-[3vw] font-medium text-foreground">
            {a.name} <span className="font-mono tabular">{a.wins}</span> to <span className="font-mono tabular">{b.wins}</span> {b.name}
          </p>
          <p className="font-mono text-[2vw] tabular text-muted-foreground">{a.points} pts to {b.points} pts</p>
        </div>
      </main>
    )
  }

  const anyActive = mats.some(m => m.current !== null || recent.has(m.id))
  const done = matches.filter(m => m.status === 'done').sort((x, y) => y.id - x.id)
  const fallback = !anyActive && done.length > 0
  const tiles = fallback ? done.slice(0, 4) : []
  const columns = Math.min(4, Math.max(1, fallback ? tiles.length : mats.length))
  const large = columns === 1

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background">
      <Connecting connected={connected} />
      <HeroScore teams={teams} />
      <div
        className="grid flex-1 gap-[1vw] overflow-hidden pt-[1.4vw] px-[2.4vw] pb-[1vw]"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {fallback
          ? tiles.map(m => <ResultTile key={m.id} match={m} teams={teams} large={large} />)
          : mats.map(m => <MatTile key={m.id} mat={m} teams={teams} serverNow={snapshot.now} recent={recent.get(m.id)} large={large} />)}
      </div>
      <OnDeckStrip mats={mats} teams={teams} fallbackCount={fallback ? done.length : null} />
    </main>
  )
}
