const base = process.env.SMOKE_BASE
const pin = process.env.SMOKE_PIN

if (!base || !pin) {
  console.log('usage: SMOKE_BASE=<url> SMOKE_PIN=<pin> npm run smoke:cloud')
  process.exit(1)
}

async function j(method, p, body, token) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

function fail(step, r) {
  console.log(`FAIL: ${step}`)
  console.log(JSON.stringify(r.body ?? r))
  process.exit(1)
}

async function pollSnapshot(eventId, since = -1) {
  for (let i = 0; i < 50; i++) {
    const r = await j('GET', `/api/events/${eventId}/snapshot?since=${since}`)
    if (r.status < 200 || r.status >= 300) fail('poll snapshot', r)
    if (r.body.snapshot) return r.body
    await new Promise(res => setTimeout(res, 100))
  }
  fail('poll snapshot', { body: 'timed out waiting for snapshot' })
}

const health = await j('GET', '/api/health')
if (health.status < 200 || health.status >= 300) fail('health', health)

const auth = await j('POST', '/api/auth/admin', { pin })
if (auth.status < 200 || auth.status >= 300) fail('auth', auth)
const token = auth.body.token

const date = new Date().toISOString().slice(0, 10)
const created = await j('POST', '/api/events', {
  name: `Smoke ${Date.now()}`,
  date,
  matCount: 1,
  teams: [{ name: 'Red', color: 'red' }, { name: 'Blue', color: 'blue' }],
}, token)
if (created.status !== 201) fail('create event', created)
const eventId = created.body.event.id

const poll = await pollSnapshot(eventId)
if (poll.snapshot.event.id !== eventId) fail('verify snapshot', poll)

const deleted = await j('DELETE', `/api/events/${eventId}`, undefined, token)
if (deleted.status < 200 || deleted.status >= 300) fail('delete event', deleted)

console.log('PASS')
process.exit(0)
