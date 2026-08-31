import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'duels-e2e-'))
const port = 8499
const base = `http://127.0.0.1:${port}`
const server = spawn('node', ['dist/index.js'], {
  cwd: 'server',
  env: { ...process.env, ADMIN_PIN: '123456', PORT: String(port), DB_PATH: path.join(dir, 'e2e.db') },
  stdio: ['ignore', 'inherit', 'inherit'],
})

const assert = (cond, msg) => { if (!cond) throw new Error(`e2e failed: ${msg}`) }

async function j(method, p, body, token) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('server did not come up')
}

async function pollSnapshot(eventId, since = -1) {
  for (let i = 0; i < 50; i++) {
    const r = await j('GET', `/api/events/${eventId}/snapshot?since=${since}`)
    if (r.body.snapshot) return r.body
    await new Promise(res => setTimeout(res, 100))
  }
  throw new Error('no new snapshot')
}

try {
  await waitForHealth()
  const admin = (await j('POST', '/api/auth/admin', { pin: '123456' })).body.token
  const created = await j('POST', '/api/events', { name: 'E2E', date: '2026-10-03', matCount: 1, teams: [{ name: 'A', color: 'red' }, { name: 'B', color: 'blue' }] }, admin)
  assert(created.status === 201, 'event created')
  const eventId = created.body.event.id
  const [teamA, teamB] = created.body.teams
  const matId = created.body.mats[0].id
  for (const [last, teamId] of [['Alpha', teamA.id], ['Bravo', teamB.id]]) {
    const r = await j('POST', `/api/events/${eventId}/athletes`, { manual: { firstName: 'Test', lastName: last, age: 8, weightLbs: 60, belt: 'grey', gender: 'M', teamId } }, admin)
    assert(r.status === 201, `athlete ${last}`)
  }
  const gen = await j('POST', `/api/events/${eventId}/matches/generate`, undefined, admin)
  assert(gen.body.created === 1, 'one match generated')
  assert((await j('PATCH', `/api/events/${eventId}`, { status: 'live' }, admin)).status === 200, 'event live')
  const { matCode } = (await j('GET', `/api/events/${eventId}/connect`, undefined, admin)).body
  const bind = await j('POST', `/api/events/${eventId}/mats/${matId}/bind`, { code: matCode })
  assert(bind.status === 200, 'mat bound')
  const mat = bind.body.token

  let poll = await pollSnapshot(eventId)
  assert(poll.snapshot.event.id === eventId, 'first snapshot')
  const matchId = poll.snapshot.mats[0].current.id
  const athleteA = poll.snapshot.mats[0].current.a.athleteId

  const scored = await j('POST', `/api/matches/${matchId}/events`, { id: 'e2e-score-0001', type: 'score', athleteId: athleteA, actionKey: 'mount', lastSeq: 0 }, mat)
  assert(scored.status === 200 && scored.body.match.a.score === 4, 'mount scored')
  poll = await pollSnapshot(eventId, poll.version)
  assert(poll.snapshot.teams[0].points === 4, 'team points in snapshot')
  const ended = await j('POST', `/api/matches/${matchId}/end`, { id: 'e2e-end-0001', lastSeq: 1 }, mat)
  assert(ended.body.match.status === 'done', 'match done')
  poll = await pollSnapshot(eventId, poll.version)
  assert(poll.snapshot.teams[0].wins === 1, 'team win in snapshot')
  console.log('e2e ok')
} finally {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
}
