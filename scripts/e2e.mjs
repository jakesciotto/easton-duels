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

// The record after the afternoon: the organizer finishes, signs it off, and everything
// stops moving until somebody unlocks it with a reason.
async function certifyArm(admin) {
  const created = await j('POST', '/api/events', {
    name: 'E2E Certify', date: '2026-10-05', matCount: 1,
    teams: [{ name: 'Ridge', color: 'red' }, { name: 'Lake', color: 'blue' }],
  }, admin)
  assert(created.status === 201, 'certify event created')
  const eventId = created.body.event.id
  const [teamA, teamB] = created.body.teams
  const matId = created.body.mats[0].id
  for (const [last, teamId] of [['Echo', teamA.id], ['Foxtrot', teamB.id]]) {
    assert((await j('POST', `/api/events/${eventId}/athletes`, { manual: { firstName: 'Cert', lastName: last, age: 9, weightLbs: 66, belt: 'grey', gender: 'M', teamId } }, admin)).status === 201, `certify athlete ${last}`)
  }
  const drafts = await j('POST', `/api/events/${eventId}/proposals`, undefined, admin)
  assert(drafts.body.length === 1, 'certify match proposed')
  assert((await j('POST', `/api/events/${eventId}/proposals/confirm-all`, undefined, admin)).body.created === 1, 'certify match confirmed')
  assert((await j('PATCH', `/api/events/${eventId}`, { status: 'live' }, admin)).status === 200, 'certify event live')

  const { matCode } = (await j('GET', `/api/events/${eventId}/connect`, undefined, admin)).body
  const mat = (await j('POST', `/api/events/${eventId}/mats/${matId}/bind`, { code: matCode })).body.token
  const snap = (await pollSnapshot(eventId)).snapshot
  const matchId = snap.mats[0].current.id
  const athleteA = snap.mats[0].current.a.athleteId
  const athleteB = snap.mats[0].current.b.athleteId
  assert((await j('POST', `/api/matches/${matchId}/events`, { id: 'e2e-cert-score-1', type: 'score', athleteId: athleteA, actionKey: 'mount', lastSeq: 0 }, mat)).status === 200, 'certify arm scored')
  assert((await j('POST', `/api/matches/${matchId}/end`, { id: 'e2e-cert-end-1', lastSeq: 1 }, mat)).status === 200, 'certify arm match ended')
  assert((await j('PATCH', `/api/events/${eventId}`, { status: 'done' }, admin)).status === 200, 'certify arm event finished')

  // Finish ends the afternoon, it does not close the record: the desk can still fix a
  // result that settled. What it refuses is a new one.
  const correction = (id, reason) => j('POST', `/api/matches/${matchId}/entry`, {
    entryId: id, pointsA: 0, pointsB: 4, winnerAthleteId: athleteB, winType: 'points', reason,
  }, admin)
  const afterFinish = await correction('e2e-cert-fix-1', 'the mat called the wrong colour')
  assert(afterFinish.status === 200, 'a finished event still takes a correction')
  assert(afterFinish.body.match.result.winnerAthleteId === athleteB, 'the correction moved the winner')

  const wrongPin = await j('POST', `/api/events/${eventId}/certify`, { pin: '000000' }, admin)
  assert(wrongPin.status === 401, 'certify asks for the PIN again')
  const certified = await j('POST', `/api/events/${eventId}/certify`, { pin: '123456' }, admin)
  assert(certified.status === 200, 'event certified')
  assert(certified.body.event.status === 'certified', 'the event reads as certified')
  assert(typeof certified.body.event.certifiedAt === 'string', 'the detail carries certifiedAt')

  const locked = (await j('GET', `/api/events/${eventId}/snapshot`)).body.snapshot
  assert(locked.event.status === 'certified', 'the snapshot reads as certified')
  assert(locked.event.certifiedAt === certified.body.event.certifiedAt, 'the snapshot carries certifiedAt')

  const refusedScore = await j('POST', `/api/matches/${matchId}/events`, { id: 'e2e-cert-score-2', type: 'score', athleteId: athleteA, actionKey: 'mount', lastSeq: 2 }, mat)
  assert(refusedScore.status === 409 && refusedScore.body.error.message === 'event is certified', 'a certified event refuses a scoring write')
  const refusedFix = await correction('e2e-cert-fix-2', 'a second thought')
  assert(refusedFix.status === 409 && refusedFix.body.error.message === 'event is certified', 'a certified event refuses a correction')
  const refusedRoster = await j('POST', `/api/events/${eventId}/matches/reorder`, { ids: [matchId] }, admin)
  assert(refusedRoster.status === 409 && refusedRoster.body.error.message === 'event is certified', 'a certified event refuses the running order too')

  const unlocked = await j('POST', `/api/events/${eventId}/uncertify`, { pin: '123456', reason: 'mat 1 score was called wrong' }, admin)
  assert(unlocked.status === 200, 'event unlocked')
  assert(unlocked.body.event.status === 'done' && unlocked.body.event.certifiedAt === null, 'an unlock returns the event to done')
  const afterUnlock = await correction('e2e-cert-fix-3', 'and back again')
  assert(afterUnlock.status === 200, 'an unlocked event takes the correction again')
  const reordered = await j('POST', `/api/events/${eventId}/matches/reorder`, { ids: [matchId] }, admin)
  assert(reordered.status === 200, 'the running order moves again once unlocked')
  // The one thing an unlock does not reopen: the event is still finished, so nothing new
  // gets scored into it.
  const fresh = await j('POST', `/api/events/${eventId}/entries`, {
    entryId: 'e2e-cert-entry-1', athleteAId: athleteA, athleteBId: athleteB, pointsA: 1, pointsB: 0, winnerAthleteId: athleteA, winType: 'points',
  }, admin)
  assert(fresh.status === 409 && fresh.body.error.message === 'event is done', 'a finished event still refuses a new result')

  const matchHistory = (await j('GET', `/api/matches/${matchId}/history`, undefined, admin)).body
  // A confirmed proposal wrote this match into existence, and Start loaded it onto its one
  // mat, which is the match_create and advance rows ahead of the mat's own score.
  assert(matchHistory.map(r => r.action).join() === 'match_create,advance,score,end,correction,correction', 'the match history lists the match_create, the advance, the mat, and both corrections')
  assert(matchHistory.map(r => r.actor).join() === 'admin,system,mat:1,mat:1,desk,desk', 'the match history names who did each')
  assert(matchHistory[4].detail.reason === 'the mat called the wrong colour', 'a correction carries its reason')
  assert(matchHistory[4].detail.before.winnerAthleteId === athleteA && matchHistory[4].detail.after.winnerAthleteId === athleteB, 'a correction carries both sides')
  const eventHistory = (await j('GET', `/api/events/${eventId}/history`, undefined, admin)).body
  const signed = eventHistory.filter(r => r.action === 'certify' || r.action === 'uncertify')
  assert(signed.map(r => r.action).join() === 'certify,uncertify', 'the history lists the certify and uncertify rows')
  assert(signed[1].detail.reason === 'mat 1 score was called wrong', 'the unlock carries its reason')
}

// The one destructive path on the console. A setup event goes on a plain confirm; an
// event with results asks for the PIN, the same way certify does.
async function deleteArm(admin) {
  const setup = await j('POST', '/api/events', {
    name: 'E2E Delete', date: '2026-10-06', matCount: 1,
    teams: [{ name: 'Ridge', color: 'red' }, { name: 'Lake', color: 'blue' }],
  }, admin)
  assert(setup.status === 201, 'delete arm event created')
  const setupId = setup.body.event.id
  const [teamA, teamB] = setup.body.teams

  const bulk = await j('POST', `/api/events/${setupId}/athletes`, {
    bulk: [
      { firstName: 'Delta', lastName: 'One', age: 9, weightLbs: 60, belt: 'grey', gender: 'M', teamId: teamA.id },
      { firstName: 'Delta', lastName: 'Two', age: 9, weightLbs: 62, belt: 'grey', gender: 'M', teamId: teamB.id },
    ],
  }, admin)
  assert(bulk.status === 201, 'delete arm bulk paste accepted')

  const plainDelete = await j('DELETE', `/api/events/${setupId}`, {}, admin)
  assert(plainDelete.status === 204, 'a setup event deletes on a plain confirm')
  const gone = await j('GET', `/api/events/${setupId}`, undefined, admin)
  assert(gone.status === 404, 'the deleted event is gone')

  const live = await j('POST', '/api/events', {
    name: 'E2E Delete Live', date: '2026-10-07', matCount: 1,
    teams: [{ name: 'Ridge', color: 'red' }, { name: 'Lake', color: 'blue' }],
  }, admin)
  assert(live.status === 201, 'delete arm second event created')
  const liveId = live.body.event.id
  assert((await j('PATCH', `/api/events/${liveId}`, { status: 'live' }, admin)).status === 200, 'delete arm event live')

  const noPin = await j('DELETE', `/api/events/${liveId}`, {}, admin)
  assert(noPin.status === 422, 'a live event refuses delete without the PIN')
  const withPin = await j('DELETE', `/api/events/${liveId}`, { pin: '123456' }, admin)
  assert(withPin.status === 204, 'the right PIN deletes a live event')
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
  const proposed = await j('POST', `/api/events/${eventId}/proposals`, undefined, admin)
  assert(proposed.body.length === 1, 'one match proposed')
  assert(proposed.body[0].why === 'same class, same age', 'the draft says why the pair fits')
  assert((await j('POST', `/api/events/${eventId}/proposals/confirm-all`, undefined, admin)).body.created === 1, 'one match confirmed')
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
  assert(/^[A-Za-z]+ [A-Z]\.$/.test(poll.snapshot.matches[0].a.name), 'public snapshot carries a first name and an initial')

  await entryArm(admin)
  await certifyArm(admin)
  await deleteArm(admin)
  console.log('e2e ok')
} finally {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
}
