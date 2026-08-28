import { serve } from '@hono/node-server'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 8422)
const app = createApp({ port } as never)

serve({ fetch: app.fetch, port }, () => console.log(`duels on :${port}`))
