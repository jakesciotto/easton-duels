import { handle } from '@hono/node-server/vercel'
import { createApp } from '../server/src/app.js'
import { createDb, dbUrlFromEnv, initDb, getOrCreateSecret } from '../server/src/db/client.js'
import { validateAdminPin } from '../server/src/auth/pin.js'
import { rosterFromEnv } from '../server/src/roster/config.js'

const ready = (async () => {
  const opts = dbUrlFromEnv(process.env)
  const db = createDb(opts)
  await initDb(db, opts)
  const app = createApp({
    port: 0, db, secret: await getOrCreateSecret(db),
    adminPin: validateAdminPin(process.env.ADMIN_PIN),
    roster: rosterFromEnv(process.env),
    publicUrl: process.env.PUBLIC_URL,
  })
  app.all('*', c => c.json({ error: { code: 'not_found', message: 'not found' } }, 404))
  return app
})()

export default async function handler(req: unknown, res: unknown) {
  return handle(await ready)(req as never, res as never)
}
