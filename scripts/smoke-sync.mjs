const base = process.env.SMOKE_BASE
const pin = process.env.SMOKE_PIN
const exactFull = process.env.SMOKE_EXACT
const nearFull = process.env.SMOKE_NEAR
const fakeFull = process.env.SMOKE_FAKE

if (!base || !pin || !exactFull || !nearFull || !fakeFull) {
  console.log('usage: SMOKE_BASE=<url> SMOKE_PIN=<pin> SMOKE_EXACT="First Last" SMOKE_NEAR="First Last" SMOKE_FAKE="First Last" [SMOKE_SEARCH=<text>] node scripts/smoke-sync.mjs')
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

// Never print a real name. First letters only, so a person reading the log can tell
// the three rows apart without the file or its output ever carrying a full name.
function mask(full) {
  return full.trim().split(/\s+/).filter(Boolean).map(w => `${w[0].toUpperCase()}.`).join(' ')
}

function splitName(full) {
  const i = full.indexOf(' ')
  if (i === -1) return { firstName: full, lastName: '' }
  return { firstName: full.slice(0, i), lastName: full.slice(i + 1) }
}

function findByName(rows, person) {
  return rows.find(r => r.firstName === person.firstName && r.lastName === person.lastName)
}

function byId(rows, id) {
  return rows.find(r => r.id === id)
}

const exact = splitName(exactFull)
const near = splitName(nearFull)
const fake = splitName(fakeFull)
const searchText = process.env.SMOKE_SEARCH || exact.lastName
const usingDefaultSearch = !process.env.SMOKE_SEARCH

let eventId
let token
let failed = false

try {
  // 1. health
  const health = await j('GET', '/api/health')
  if (health.status < 200 || health.status >= 300) fail('health', health)
  ok('health', `status ${health.status}`)

  // 2. admin auth
  const auth = await j('POST', '/api/auth/admin', { pin })
  if (auth.status < 200 || auth.status >= 300) fail('auth', auth)
  token = auth.body.token
  ok('auth', 'token acquired')

  // 3. create event: one mat, two teams
  const date = new Date().toISOString().slice(0, 10)
  const created = await j('POST', '/api/events', {
    name: `Smoke sync ${Date.now()}`,
    date,
    matCount: 1,
    teams: [{ name: 'Red', color: 'red' }, { name: 'Blue', color: 'blue' }],
  }, token)
  if (created.status !== 201) fail('create event', created)
  eventId = created.body.event.id
  const teamId = created.body.teams[0].id
  ok('create event', `id ${eventId}`)

  // 4. bulk add the three rows on the first team, no age/weight/belt/gender
  const bulk = [exact, near, fake].map(p => ({ firstName: p.firstName, lastName: p.lastName, teamId }))
  const added = await j('POST', `/api/events/${eventId}/athletes`, { bulk }, token)
  if (added.status !== 201) fail('add athletes', added)
  const exactRow = findByName(added.body, exact)
  const nearRow = findByName(added.body, near)
  const fakeRow = findByName(added.body, fake)
  if (!exactRow || !nearRow || !fakeRow) fail('add athletes', { body: 'one or more rows missing after bulk add' })
  ok('add athletes', `${mask(exactFull)}, ${mask(nearFull)}, ${mask(fakeFull)}`)

  // 5. sync with no body
  const t0 = Date.now()
  const sync1 = await j('POST', `/api/events/${eventId}/roster/sync`, undefined, token)
  const ms1 = Date.now() - t0
  if (sync1.status < 200 || sync1.status >= 300) fail('roster sync', sync1)
  const { candidates, warnings, report } = sync1.body
  if (!Array.isArray(candidates) || !Array.isArray(warnings) || !report) fail('roster sync shape', sync1)
  ok('roster sync', `${ms1}ms, candidates ${candidates.length}`)
  if (warnings.length > 0) console.log(`warnings: ${JSON.stringify(warnings)}`)
  console.log(`report: linked=${report.linked.length} refreshed=${report.refreshed} changed=${report.changed.length} suggested=${report.suggested.length} ambiguous=${report.ambiguous.length} unmatched=${report.unmatched.length} gone=${report.gone.length}`)

  const ev1 = await j('GET', `/api/events/${eventId}`, undefined, token)
  if (ev1.status < 200 || ev1.status >= 300) fail('read event after sync', ev1)
  const exactAfter1 = byId(ev1.body.athletes, exactRow.id)
  const nearAfter1 = byId(ev1.body.athletes, nearRow.id)
  const fakeAfter1 = byId(ev1.body.athletes, fakeRow.id)
  if (!exactAfter1 || !exactAfter1.wlUid) fail('exact row linked', { body: exactAfter1 })
  if (!nearAfter1 || nearAfter1.wlUid || !nearAfter1.suggestedWlUid || nearAfter1.suggestedScore == null) fail('near row suggested', { body: nearAfter1 })
  if (!fakeAfter1 || fakeAfter1.wlUid || fakeAfter1.suggestedWlUid || !fakeAfter1.syncedAt) fail('fake row unmatched', { body: fakeAfter1 })
  ok('verify sync', `exact linked, near suggested (score ${nearAfter1.suggestedScore}), fake unmatched with syncedAt`)

  // 6. wl-search: default query returns the exact row on top, a one letter query is rejected
  const ts = Date.now()
  const search1 = await j('GET', `/api/events/${eventId}/wl-search?q=${encodeURIComponent(searchText)}`, undefined, token)
  const msSearch = Date.now() - ts
  if (search1.status < 200 || search1.status >= 300) fail('wl search', search1)
  if (!Array.isArray(search1.body) || search1.body.length === 0) fail('wl search empty', search1)
  if (usingDefaultSearch && search1.body[0].wlUid !== exactAfter1.wlUid) fail('wl search top match', { body: 'top result wlUid does not match the exact row' })
  ok('wl search', `${msSearch}ms, ${search1.body.length} results, query=${usingDefaultSearch ? 'default' : 'custom'}`)

  const search2 = await j('GET', `/api/events/${eventId}/wl-search?q=a`, undefined, token)
  if (search2.status !== 422) fail('wl search short query', search2)
  const err2 = search2.body && search2.body.error
  if (!err2 || err2.code !== 'validation' || err2.message !== 'Type at least two letters.') fail('wl search short query shape', search2)
  ok('wl search validation', '422 validation on a one letter query')

  // 6b. a two letter query already searches, and still finds the exact row
  if (usingDefaultSearch && searchText.length >= 2) {
    const two = searchText.slice(0, 2)
    const search3 = await j('GET', `/api/events/${eventId}/wl-search?q=${encodeURIComponent(two)}`, undefined, token)
    if (search3.status < 200 || search3.status >= 300) fail('wl search two letters', search3)
    if (!Array.isArray(search3.body) || !search3.body.some(c => c.wlUid === exactAfter1.wlUid)) fail('wl search two letters finds the exact row', { body: `count ${Array.isArray(search3.body) ? search3.body.length : 'n/a'}` })
    ok('wl search two letters', `${search3.body.length} results include the exact row`)
  }

  // 7. link the near row to its suggestion
  const linked = await j('POST', `/api/athletes/${nearRow.id}/link`, { wlUid: nearAfter1.suggestedWlUid }, token)
  if (linked.status < 200 || linked.status >= 300) fail('link near row', linked)
  ok('link near row', 'linked to suggested wlUid')

  const ev2 = await j('GET', `/api/events/${eventId}`, undefined, token)
  if (ev2.status < 200 || ev2.status >= 300) fail('read event after link', ev2)
  const nearAfter2 = byId(ev2.body.athletes, nearRow.id)
  if (!nearAfter2 || nearAfter2.wlUid !== nearAfter1.suggestedWlUid) fail('near row wlUid after link', { body: nearAfter2 })
  ok('verify link', 'near row wlUid matches the suggestion')

  // 8. dismiss on the fake row, only if a candidate exists to dismiss
  const fakeSearch = await j('GET', `/api/events/${eventId}/wl-search?q=${encodeURIComponent(fake.lastName)}`, undefined, token)
  if (fakeSearch.status < 200 || fakeSearch.status >= 300) fail('wl search fake row', fakeSearch)
  if (Array.isArray(fakeSearch.body) && fakeSearch.body.length > 0) {
    const dismissUid = fakeSearch.body[0].wlUid
    const dismissed = await j('POST', `/api/athletes/${fakeRow.id}/dismiss`, { wlUid: dismissUid }, token)
    if (dismissed.status < 200 || dismissed.status >= 300) fail('dismiss fake row', dismissed)
    const ev3 = await j('GET', `/api/events/${eventId}`, undefined, token)
    if (ev3.status < 200 || ev3.status >= 300) fail('read event after dismiss', ev3)
    const fakeAfter3 = byId(ev3.body.athletes, fakeRow.id)
    if (!fakeAfter3 || !fakeAfter3.dismissedWlUids.includes(dismissUid)) fail('dismiss recorded', { body: fakeAfter3 })
    ok('dismiss fake row', 'dismissedWlUids updated')
  } else {
    console.log('skip dismiss (no candidate)')
  }

  // 9. sync again, no body: exact and near keep their wlUid, fake stays unlinked
  const t1 = Date.now()
  const sync2 = await j('POST', `/api/events/${eventId}/roster/sync`, undefined, token)
  const ms2 = Date.now() - t1
  if (sync2.status < 200 || sync2.status >= 300) fail('roster sync again', sync2)
  ok('roster sync again', `${ms2}ms`)

  const ev4 = await j('GET', `/api/events/${eventId}`, undefined, token)
  if (ev4.status < 200 || ev4.status >= 300) fail('read event after second sync', ev4)
  const exactAfter4 = byId(ev4.body.athletes, exactRow.id)
  const nearAfter4 = byId(ev4.body.athletes, nearRow.id)
  const fakeAfter4 = byId(ev4.body.athletes, fakeRow.id)
  if (!exactAfter4 || exactAfter4.wlUid !== exactAfter1.wlUid) fail('exact row still linked', { body: exactAfter4 })
  if (!nearAfter4 || nearAfter4.wlUid !== nearAfter1.suggestedWlUid) fail('near row still linked', { body: nearAfter4 })
  if (!fakeAfter4 || fakeAfter4.wlUid) fail('fake row still unlinked', { body: fakeAfter4 })
  ok('verify second sync', 'exact and near kept wlUid, fake stayed unlinked')

  // 10. sync with a body: the body is ignored under the new contract
  const sync3 = await j('POST', `/api/events/${eventId}/roster/sync`, { kBusinesses: ['ignored'] }, token)
  if (sync3.status < 200 || sync3.status >= 300) fail('roster sync with body', sync3)
  ok('roster sync with body', 'ignored body still answers 2xx')

  // 11. the candidate pool is the subset, not the whole gym
  const cands = await j('GET', `/api/events/${eventId}/candidates`, undefined, token)
  if (cands.status < 200 || cands.status >= 300) fail('candidates', cands)
  if (!Array.isArray(cands.body)) fail('candidates shape', cands)
  if (cands.body.length >= 200) fail('candidates pool too large', { body: `count ${cands.body.length}` })
  ok('candidates', `count ${cands.body.length}`)
} catch (e) {
  failed = true
  if (!(e instanceof SmokeFailure)) {
    console.log('FAIL: unexpected error')
    console.log(e instanceof Error ? (e.stack ?? e.message) : String(e))
  }
} finally {
  // 12. always try to delete the event, even after a failed step above
  if (eventId !== undefined) {
    try {
      const deleted = await j('DELETE', `/api/events/${eventId}`, undefined, token)
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
