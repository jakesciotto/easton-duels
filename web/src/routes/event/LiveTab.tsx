import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { MatchView } from '@shared/types'
import { adminApi, useAdminMutation } from '@/lib/queries'
import { useSnapshot } from '@/lib/useSnapshot'
import { winTypeLabel } from '@/lib/format'
import type { EventDetail } from '@/lib/types'
import { Clock } from '@/components/Clock'
import { Connecting } from '@/components/Connecting'
import { QrCode } from '@/components/QrCode'
import { TeamDot } from '@/components/TeamDot'
import { ResultDialog } from './ResultDialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ConnectInfo { url: string; matCode: string }

export function LiveTab({ detail }: { detail: EventDetail }) {
  const eventId = detail.event.id
  const { snapshot, connected } = useSnapshot(eventId)
  const [connect, setConnect] = useState<ConnectInfo | null>(null)
  const [editing, setEditing] = useState<MatchView | null>(null)
  const [finishOpen, setFinishOpen] = useState(false)

  useEffect(() => {
    let ignore = false
    adminApi<ConnectInfo>(`/api/events/${eventId}/connect`).then(c => { if (!ignore) setConnect(c) }).catch(() => {})
    return () => { ignore = true }
  }, [eventId])

  const status = useAdminMutation(eventId, (s: 'live' | 'done') => adminApi(`/api/events/${eventId}`, { method: 'PATCH', body: { status: s } }))
  const act = useAdminMutation(eventId, (v: { id: number; action: 'reopen' | 'skip' }) => adminApi(`/api/matches/${v.id}/${v.action}`, { method: 'POST' }))
  // Only the most recently started action's error stays visible.
  const runStart = () => { act.reset(); status.mutate('live') }
  const runAct = (v: { id: number; action: 'reopen' | 'skip' }) => { status.reset(); act.mutate(v) }
  // Cancel, the backdrop, Escape, and a successful finish all close through here, so a
  // failed finish's message never outlives the dialog it was shown in.
  const closeFinish = () => {
    setFinishOpen(false)
    status.reset()
  }
  const runFinish = () => {
    act.reset()
    status.mutate('done', { onSuccess: closeFinish })
  }
  // While the dialog is open a failed finish is shown inside it only.
  const error = (finishOpen ? null : status.error) ?? act.error
  const matUrl = connect ? `${connect.url}/mat?event=${eventId}` : ''

  const teamColor = (teamId: number | null) => detail.teams.find(t => t.id === teamId)?.color ?? detail.teams[0].color
  const statusVariant = detail.event.status === 'live' ? 'live' : detail.event.status === 'done' ? 'done' : 'default'

  return (
    <div className="grid gap-6">
      <Connecting connected={connected} />
      <div className="grid items-start gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4">
            {connect ? <QrCode text={matUrl} size={160} /> : <div style={{ width: 160, height: 160 }} className="rounded-lg bg-muted" aria-hidden />}
            <div className="grid gap-3 text-sm">
              <div className="grid gap-1">
                <span className="label">iPads open</span>
                <span className="font-mono">{connect?.url ?? 'Loading'}</span>
              </div>
              <div className="grid gap-1">
                <span className="label">Mat code</span>
                <span className="font-mono text-4xl font-black tabular tracking-[0.3em]">{connect?.matCode ?? ''}</span>
              </div>
              <Link to={`/connect?event=${eventId}`} target="_blank" className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'w-fit px-0' })}>Open the connect page</Link>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              <span className="label">Event status</span>
              <Badge variant={statusVariant}>{detail.event.status}</Badge>
            </div>
            {detail.event.status === 'setup' && <Button onClick={runStart} disabled={status.isPending}>Start event</Button>}
            {detail.event.status === 'live' && (
              <Button variant="destructive" onClick={() => setFinishOpen(true)} disabled={status.isPending}>Finish event</Button>
            )}
            {error && <p role="alert" className="text-[13px] text-destructive">{error.message}</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3">
        <h3 className="label">Mats</h3>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="label px-3 py-2">Mat</th>
                <th className="label px-3 py-2">Current match</th>
                <th className="label px-3 py-2">Clock</th>
                <th className="label px-3 py-2">Scorer</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(snapshot?.mats ?? []).map(m => {
                const current = m.current
                return (
                  <tr key={m.id} aria-label={`Mat ${m.number}`} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5 font-semibold">Mat {m.number}</td>
                    <td className="px-3 py-2.5">
                      {current ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <TeamDot color={teamColor(current.a.teamId)} name={current.a.name} />
                          <span className="font-mono tabular text-soft">{current.a.score}</span>
                          <span className="text-xs text-faint">to</span>
                          <span className="font-mono tabular text-soft">{current.b.score}</span>
                          <TeamDot color={teamColor(current.b.teamId)} name={current.b.name} />
                        </div>
                      ) : (
                        <span className="text-faint">Idle</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{current ? <Clock clock={current.clock} serverNow={snapshot?.now ?? null} /> : <span className="text-faint">-</span>}</td>
                    <td className="px-3 py-2.5"><Badge variant={m.bound ? 'live' : 'default'}>{m.bound ? 'scorer connected' : 'no scorer'}</Badge></td>
                    <td className="px-3 py-2.5">
                      {current && (
                        <Button size="sm" variant="destructive" onClick={() => runAct({ id: current.id, action: 'skip' })} disabled={act.isPending}>Skip</Button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {(snapshot?.mats ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-2.5 text-[13px] text-faint">Waiting for the stream</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3">
        <h3 className="label">Matches</h3>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="label px-3 py-2">#</th>
                <th className="label px-3 py-2">Match</th>
                <th className="label px-3 py-2">Status</th>
                <th className="label px-3 py-2">Result</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(snapshot?.matches ?? []).filter(m => m.status !== 'pending').map(m => (
                <tr key={m.id} aria-label={`Match ${m.orderIndex + 1}`} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5 font-mono tabular text-faint">{m.orderIndex + 1}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <TeamDot color={teamColor(m.a.teamId)} name={m.a.name} />
                      <span className="font-mono tabular text-soft">{m.a.score}</span>
                      <span className="text-xs text-faint">to</span>
                      <span className="font-mono tabular text-soft">{m.b.score}</span>
                      <TeamDot color={teamColor(m.b.teamId)} name={m.b.name} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><Badge variant={m.status === 'live' ? 'live' : 'done'}>{m.status}</Badge></td>
                  <td className="px-3 py-2.5 text-soft">{m.result ? `${m.result.winnerAthleteId === m.a.athleteId ? m.a.name : m.b.name} ${winTypeLabel(m.result.winType)}` : ''}</td>
                  <td className="px-3 py-2.5">
                    {m.status === 'done' && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => runAct({ id: m.id, action: 'reopen' })} disabled={act.isPending}>Reopen</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>Edit result</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {(snapshot?.matches ?? []).filter(m => m.status !== 'pending').length === 0 && (
                <tr><td colSpan={5} className="px-3 py-2.5 text-[13px] text-faint">No live or finished matches yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={finishOpen} onOpenChange={o => { if (o) setFinishOpen(true); else closeFinish() }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Finish the event?</DialogTitle></DialogHeader>
          <DialogBody>
            <p className="text-sm text-soft">The board switches to the final result. Matches that are still running stay where they are.</p>
            {status.error && <p role="alert" className="text-[13px] text-destructive">{status.error.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeFinish}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={status.isPending} onClick={runFinish}>Finish event</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ResultDialog detail={detail} match={editing} open={editing !== null} onOpenChange={o => { if (!o) setEditing(null) }} />
    </div>
  )
}
