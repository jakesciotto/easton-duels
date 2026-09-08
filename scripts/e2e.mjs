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

// The desk path, which shares no route with the live arm above: the mats stay idle all
// afternoon, every result is typed, and a typed result for a designed pair has to land on
// that pair's match rather than a second copy of it.
async function entryArm(admin) {
  const created = await j('POST', '/api/events', {
    name: 'E2E Desk', date: '2026-10-04', matCount: 2, mode: 'entry',
    teams: [{ name: 'Ridge', color: 'red' }, { name: 'Lake', color: 'blue' }],
  }, admin)
  assert(created.status === 201, 'entry event created')
  assert(created.body.event.mode === 'entry', 'entry event runs from the desk')
  const eventId = created.body.event.id
  const [teamA, teamB] = created.body.teams

  const kids = {}
  for (const [last, teamId] of [['Alpha', teamA.id], ['Charlie', teamA.id], ['Bravo', teamB.id], ['Delta', teamB.id]]) {
    const r = await j('POST', `/api/events/${eventId}/athletes`, { manual: { firstName: 'Desk', lastName: last, age: 9, weightLbs: 65, belt: 'grey', gender: 'M', teamId } }, admin)
    assert(r.status === 201, `entry athlete ${last}`)
    kids[last] = r.body.find(a => a.lastName === last)?.id
    assert(typeof kids[last] === 'number', `entry athlete id for ${last}`)
  }

  const designed = []
  for (const [a, b] of [['Alpha', 'Bravo'], ['Charlie', 'Delta']]) {
    const r = await j('POST', `/api/events/${eventId}/matches`, { athleteAId: kids[a], athleteBId: kids[b] }, admin)
    assert(r.status === 201, `designed match ${a} v ${b}`)
    designed.push(r.body.id)
  }

  assert((await j('PATCH', `/api/events/${eventId}`, { status: 'live' }, admin)).status === 200, 'entry event live')
  let snap = (await pollSnapshot(eventId)).snapshot
  assert(snap.mats.length === 2, 'entry event has both mats')
  assert(snap.mats.every(m => m.current === null), 'Start leaves every mat idle in entry mode')
  assert(snap.matches.every(m => m.status === 'pending'), 'every designed match stays pending')

  const onDesigned = await j('POST', `/api/events/${eventId}/entries`, {
    entryId: 'e2e-entry-0001', athleteAId: kids.Alpha, athleteBId: kids.Bravo,
    pointsA: 5, pointsB: 2, winnerAthleteId: kids.Alpha, winType: 'points',
  }, admin)
  assert(onDesigned.status === 201, 'entry on a designed pair accepted')
  assert(onDesigned.body.match.id === designed[0], 'entry landed on the designed match')
  snap = (await pollSnapshot(eventId)).snapshot
  assert(snap.matches.length === 2, 'a designed pair does not create a second match')

  const adHoc = await j('POST', `/api/events/${eventId}/entries`, {
    entryId: 'e2e-entry-0002', athleteAId: kids.Alpha, athleteBId: kids.Delta,
    pointsA: 3, pointsB: 0, winnerAthleteId: kids.Alpha, winType: 'submission',
  }, admin)
  assert(adHoc.status === 201, 'ad hoc entry accepted')
  assert(!designed.includes(adHoc.body.match.id), 'ad hoc entry made its own match')
  snap = (await pollSnapshot(eventId)).snapshot
  assert(snap.matches.length === 3, 'ad hoc entry added exactly one match')

  assert((await j('PATCH', `/api/events/${eventId}`, { status: 'done' }, admin)).status === 200, 'entry event finished')
  const late = await j('POST', `/api/events/${eventId}/entries`, {
    entryId: 'e2e-entry-0003', athleteAId: kids.Charlie, athleteBId: kids.Delta,
    pointsA: 1, pointsB: 0, winnerAthleteId: kids.Charlie, winType: 'points',
  }, admin)
  assert(late.status === 409, 'a finished event refuses another entry')
  assert(late.body.error.code === 'match_state', 'the refusal names the state')

  const final = (await j('GET', `/api/events/${eventId}/snapshot`)).body.snapshot
  assert(final.teams[0].wins === 2 && final.teams[1].wins === 0, 'both typed wins on the board')
  assert(final.teams[0].points === 8 && final.teams[1].points === 2, 'typed points on the board')
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

  await entryArm(admin)
  console.log('e2e ok')
} finally {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
}
