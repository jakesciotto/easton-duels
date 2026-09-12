const base = process.env.SMOKE_BASE
const pin = process.env.SMOKE_PIN

if (!base || !pin) {
  console.log('usage: SMOKE_BASE=<url> SMOKE_PIN=<pin> node scripts/smoke-proposals.mjs')
  process.exit(1)
}

// fail() throws instead of exiting so the delete cleanup in the main finally block
// still runs when a step fails partway through.
class SmokeFailure extends Error {}

async function j(method, p, body, token) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  try {
    return { status: res.status, body: text ? JSON.parse(text) : null }
  } catch {
    fail(`${method} ${p} returned non-JSON`, { body: text.slice(0, 200) })
  }
}

function fail(step, r) {
  console.log(`FAIL: ${step}`)
  console.log(JSON.stringify(r.body ?? r))
  throw new SmokeFailure(step)
}

function ok(step, detail) {
  console.log(`ok ${step} (${detail})`)
}

async function pollSnapshot(eventId, since = -1) {
  for (let i = 0; i < 50; i++) {
    const r = await j('GET', `/api/events/${eventId}/snapshot?since=${since}`)
    if (r.body.snapshot) return r.body
    await new Promise(res => setTimeout(res, 100))
  }
  fail('poll snapshot', { body: 'no new snapshot' })
}

// Three invented teams. Twelve invented kids, four per team, spread over three weight
// classes (50, 65 and 85 lbs land in the "47 to 53", "62 to 70" and "81 to 90" bands, two
// classes apart from a neighbour), one kid per team in the outer two classes and two per
// team in the middle one, so every class has a kid from every team and the proposer always
// has a cross-team pair on offer.
const TEAMS = [
  { name: 'Boulder', color: 'red' },
  { name: 'Longmont', color: 'blue' },
  { name: 'McMahon & Thornton', color: 'green' },
]

const KIDS = [
  { firstName: 'Milo', lastName: 'Thistlewood', team: 'Boulder', age: 7, weightLbs: 50 },
  { firstName: 'Nova', lastName: 'Kestrelwood', team: 'Boulder', age: 9, weightLbs: 65 },
  { firstName: 'Ezra', lastName: 'Farrowgate', team: 'Boulder', age: 10, weightLbs: 65 },
  { firstName: 'Wren', lastName: 'Stonebridge', team: 'Boulder', age: 12, weightLbs: 85 },
  { firstName: 'Sage', lastName: 'Brackendale', team: 'Longmont', age: 8, weightLbs: 50 },
  { firstName: 'Arlo', lastName: 'Vantree', team: 'Longmont', age: 9, weightLbs: 65 },
  { firstName: 'Talia', lastName: 'Nordkirk', team: 'Longmont', age: 11, weightLbs: 65 },
  { firstName: 'Rowan', lastName: 'Ashgrove', team: 'Longmont', age: 12, weightLbs: 85 },
  { firstName: 'Zion', lastName: 'Pemberly', team: 'McMahon & Thornton', age: 6, weightLbs: 50 },
  { firstName: 'Piper', lastName: 'Millbrook', team: 'McMahon & Thornton', age: 10, weightLbs: 65 },
  { firstName: 'Remy', lastName: 'Dunmore', team: 'McMahon & Thornton', age: 11, weightLbs: 65 },
  { firstName: 'Juniper', lastName: 'Larkspur', team: 'McMahon & Thornton', age: 12, weightLbs: 85 },
]

let eventId
let token
let failed = false

try {
  // 1. health, admin auth
  const health = await j('GET', '/api/health')
  if (health.status < 200 || health.status >= 300) fail('health', health)
  ok('health', `status ${health.status}`)

  const auth = await j('POST', '/api/auth/admin', { pin })
  if (auth.status < 200 || auth.status >= 300) fail('auth', auth)
  token = auth.body.token
  ok('auth', 'token acquired')

  // 2. create event: three teams, one mat, then exercise team add/remove edges
  const date = new Date().toISOString().slice(0, 10)
  const created = await j('POST', '/api/events', {
    name: `Smoke proposals ${Date.now()}`,
    date,
    matCount: 1,
    teams: TEAMS,
  }, token)
  if (created.status !== 201) fail('create event', created)
  eventId = created.body.event.id
  const matRowId = created.body.mats[0].id
  if (!Array.isArray(created.body.teams) || created.body.teams.length !== 3) fail('create event teams', created)
  ok('create event', `id ${eventId}, teams ${created.body.teams.length}`)

  const teamByName = new Map(created.body.teams.map(t => [t.name, t]))
  const boulder = teamByName.get('Boulder')
  const longmont = teamByName.get('Longmont')
  let mcmahon = teamByName.get('McMahon & Thornton')

  const addedFourth = await j('POST', `/api/events/${eventId}/teams`, { name: 'Reserve', color: 'amber' }, token)
  if (addedFourth.status !== 201) fail('add fourth team', addedFourth)
  const removedFourth = await j('DELETE', `/api/events/${eventId}/teams/${addedFourth.body.id}`, undefined, token)
  if (removedFourth.status !== 204) fail('remove fourth team (no kid)', removedFourth)
  ok('add and remove a fourth team', `team ${addedFourth.body.id}, status ${removedFourth.status}`)

  const removedMcMahon = await j('DELETE', `/api/events/${eventId}/teams/${mcmahon.id}`, undefined, token)
  if (removedMcMahon.status !== 204) fail('remove third team', removedMcMahon)
  const refusedDownToOne = await j('DELETE', `/api/events/${eventId}/teams/${longmont.id}`, undefined, token)
  if (refusedDownToOne.status !== 422) fail('remove down to one team', refusedDownToOne)
  ok('remove down to one team refused', `status ${refusedDownToOne.status}`)

  const restoredMcMahon = await j('POST', `/api/events/${eventId}/teams`, { name: 'McMahon & Thornton', color: 'green' }, token)
  if (restoredMcMahon.status !== 201) fail('restore third team', restoredMcMahon)
  mcmahon = restoredMcMahon.body
  ok('restore third team', `id ${mcmahon.id}`)

  const teamIdByName = new Map([[boulder.name, boulder.id], [longmont.name, longmont.id], [mcmahon.name, mcmahon.id]])

  // 3. bulk add the twelve kids across the three teams
  const bulk = KIDS.map(k => ({ firstName: k.firstName, lastName: k.lastName, age: k.age, weightLbs: k.weightLbs, teamId: teamIdByName.get(k.team) }))
  const addedKids = await j('POST', `/api/events/${eventId}/athletes`, { bulk }, token)
  if (addedKids.status !== 201) fail('bulk add athletes', addedKids)
  const kidByName = new Map(addedKids.body.map(a => [`${a.firstName}|${a.lastName}`, a]))
  const kidId = (firstName, lastName) => {
    const row = kidByName.get(`${firstName}|${lastName}`)
    if (!row) fail('bulk add athletes', { body: `${firstName} ${lastName} missing after bulk add` })
    return row.id
  }
  const milo = kidId('Milo', 'Thistlewood')
  const arlo = kidId('Arlo', 'Vantree')
  ok('bulk add athletes', `count ${addedKids.body.length}`)

  // 4. propose: every pair crosses teams, no kid appears twice
  const proposed = await j('POST', `/api/events/${eventId}/proposals`, undefined, token)
  if (proposed.status < 200 || proposed.status >= 300) fail('propose', proposed)
  if (!Array.isArray(proposed.body) || proposed.body.length === 0) fail('propose empty', proposed)
  const seen = new Set()
  for (const p of proposed.body) {
    if (p.a.teamId === p.b.teamId) fail('propose same team', { body: p })
    if (seen.has(p.a.athleteId) || seen.has(p.b.athleteId)) fail('propose duplicate kid', { body: p })
    seen.add(p.a.athleteId)
    seen.add(p.b.athleteId)
  }
  ok('propose', `count ${proposed.body.length}`)
  console.log(`reasons: ${proposed.body.map(p => p.why).join(' | ')}`)

  // 5. swap: pull in a free kid from the third team (neither side of the first draft)
  const first = proposed.body[0]
  const thirdTeamId = [boulder.id, longmont.id, mcmahon.id].find(id => id !== first.a.teamId && id !== first.b.teamId)
  const candidate = addedKids.body.filter(a => a.teamId === thirdTeamId).sort((x, y) => x.id - y.id)[0]
  const swapped = await j('PATCH', `/api/proposals/${first.id}`, { athleteBId: candidate.id }, token)
  if (swapped.status < 200 || swapped.status >= 300) fail('swap', swapped)
  ok('swap', `proposal ${first.id}, removed ${swapped.body.removed.length}, warnings ${swapped.body.warnings.length}`)
  console.log(`swap removed: ${JSON.stringify(swapped.body.removed)}, warnings: ${JSON.stringify(swapped.body.warnings)}`)

  // 6. remove the last proposal in the list
  const beforeRemove = await j('GET', `/api/events/${eventId}/proposals`, undefined, token)
  if (beforeRemove.status < 200 || beforeRemove.status >= 300) fail('list proposals before remove', beforeRemove)
  const toRemove = beforeRemove.body[beforeRemove.body.length - 1]
  const removedProposal = await j('DELETE', `/api/proposals/${toRemove.id}`, undefined, token)
  if (removedProposal.status !== 204) fail('remove proposal', removedProposal)
  const afterRemove = await j('GET', `/api/events/${eventId}/proposals`, undefined, token)
  if (afterRemove.status < 200 || afterRemove.status >= 300) fail('list proposals after remove', afterRemove)
  if (afterRemove.body.length !== beforeRemove.body.length - 1) fail('remove proposal count', { body: `before ${beforeRemove.body.length}, after ${afterRemove.body.length}` })
  ok('remove proposal', `count ${beforeRemove.body.length} -> ${afterRemove.body.length}`)

  // 7. hand-design one match, two weight classes apart, before any match exists to have met in
  const designed = await j('POST', `/api/events/${eventId}/matches`, { athleteAId: milo, athleteBId: arlo }, token)
  if (designed.status < 200 || designed.status >= 300) fail('hand-design match', designed)
  if (designed.body.warnings.includes('Already met')) fail('hand-design match already met', designed)
  ok('hand-design match', `id ${designed.body.id}, warnings ${JSON.stringify(designed.body.warnings)}`)

  // 8. confirm all remaining proposals
  const confirmed = await j('POST', `/api/events/${eventId}/proposals/confirm-all`, undefined, token)
  if (confirmed.status !== 201) fail('confirm all', confirmed)
  ok('confirm all', `created ${confirmed.body.created}, skipped ${confirmed.body.skipped}`)

  const afterConfirm = await j('GET', `/api/events/${eventId}`, undefined, token)
  if (afterConfirm.status < 200 || afterConfirm.status >= 300) fail('read event after confirm', afterConfirm)
  const pending = afterConfirm.body.matches.filter(m => m.status === 'pending')
  if (pending.length !== 1 + confirmed.body.created) fail('pending count', { body: `pending ${pending.length}, expected ${1 + confirmed.body.created}` })
  if (!afterConfirm.body.matches.every(m => m.source === 'designed' || m.source === 'proposed')) fail('match source', afterConfirm)
  ok('verify pending matches', `pending ${pending.length} = 1 designed + ${confirmed.body.created} confirmed`)

  // 9. propose again: only kids without a pending match are offered
  const pendingAthleteIds = new Set(pending.flatMap(m => [m.athleteAId, m.athleteBId]))
  const proposedAgain = await j('POST', `/api/events/${eventId}/proposals`, undefined, token)
  if (proposedAgain.status < 200 || proposedAgain.status >= 300) fail('propose again', proposedAgain)
  for (const p of proposedAgain.body) {
    if (pendingAthleteIds.has(p.a.athleteId) || pendingAthleteIds.has(p.b.athleteId)) fail('propose again overlaps pending', { body: p })
  }
  ok('propose again', `count ${proposedAgain.body.length}`)

  // 10. score one match on the single mat and read the leaderboard
  const live = await j('PATCH', `/api/events/${eventId}`, { status: 'live' }, token)
  if (live.status !== 200) fail('event live', live)
  const connect = await j('GET', `/api/events/${eventId}/connect`, undefined, token)
  if (connect.status < 200 || connect.status >= 300) fail('connect', connect)
  const bind = await j('POST', `/api/events/${eventId}/mats/${matRowId}/bind`, { code: connect.body.matCode })
  if (bind.status !== 200) fail('bind mat', bind)
  const mat = bind.body.token
  ok('bind mat', `mat ${matRowId}`)

  let snap = (await pollSnapshot(eventId)).snapshot
  if (!snap.mats[0].current) {
    const advanced = await j('POST', `/api/mats/${matRowId}/advance`, undefined, token)
    if (advanced.status < 200 || advanced.status >= 300) fail('advance mat', advanced)
    snap = (await pollSnapshot(eventId, snap.version)).snapshot
  }
  const matchId = snap.mats[0].current.id
  const athleteA = snap.mats[0].current.a.athleteId
  const winnerTeamId = snap.mats[0].current.a.teamId

  const scored = await j('POST', `/api/matches/${matchId}/events`, { id: 'smoke-proposals-score-1', type: 'score', athleteId: athleteA, actionKey: 'mount', lastSeq: 0 }, mat)
  if (scored.status !== 200) fail('score', scored)
  ok('score', `athlete ${athleteA} scored mount`)

  const ended = await j('POST', `/api/matches/${matchId}/end`, { id: 'smoke-proposals-end-1', lastSeq: 1 }, mat)
  if (ended.status !== 200) fail('end match', ended)
  ok('end match', `match ${matchId} status ${ended.body.match.status}`)

  const final = (await j('GET', `/api/events/${eventId}/snapshot`)).body.snapshot
  if (final.leaderboard.length !== 3) fail('leaderboard length', { body: final.leaderboard })
  const ranks = final.leaderboard.map(r => r.rank).sort((a, b) => a - b)
  const pattern = JSON.stringify(ranks)
  if (pattern !== '[1,2,2]' && pattern !== '[1,2,3]') fail('leaderboard ranks', { body: final.leaderboard })
  const winnerRow = final.leaderboard.find(r => r.teamId === winnerTeamId)
  if (!winnerRow || winnerRow.rank !== 1 || winnerRow.wins !== 1) fail('winner rank', { body: final.leaderboard })
  ok('leaderboard', `ranks ${pattern}, winner team ${winnerTeamId} rank 1 wins 1`)
  console.log(`leaderboard: ${JSON.stringify(final.leaderboard)}`)
} catch (e) {
  failed = true
  if (!(e instanceof SmokeFailure)) {
    console.log('FAIL: unexpected error')
    console.log(e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
} finally {
  // 11. always try to delete the event, even after a failed step above
  if (eventId !== undefined) {
    try {
      const deleted = await j('DELETE', `/api/events/${eventId}`, { pin }, token)
      if (deleted.status >= 200 && deleted.status < 300) {
        ok('delete event', `id ${eventId}`)
      } else {
        console.log(`WARN: event ${eventId} not deleted`)
      }
    } catch {
      console.log(`WARN: event ${eventId} not deleted`)
    }
  }
}

if (failed) process.exit(1)
console.log('PASS')
process.exit(0)
