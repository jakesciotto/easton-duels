# Easton Duels

Scores a two-team kids jiu jitsu and wrestling duel. iPads at the mat tables score matches, and a
TV shows team wins and points live. One codebase runs in two modes: LAN, where one laptop runs the
server against a local file database with no cloud dependency, and cloud, where the same app
deploys to Vercel against a Turso database and serves the whole event from a public URL.

## Run at the gym (LAN mode)

1. `cp .env.example .env` and set `ADMIN_PIN` (6 digits). Add WellnessLiving and leaderboard
   credentials only if you want roster sync.
2. `npm ci && npm run build && npm start`. The server reads the repo-root `.env` on start.
3. Open `http://<laptop-ip>:8422/admin` on the laptop. The Live tab shows the URL, a QR code, and
   the mat code for the iPads.
4. iPads open `/mat`, pick a mat, and enter the mat code. The TV opens `/board/<event id>`.
5. Back up the event: under `npm start` the database is `server/data/duels.db`, because `DATA_DIR`
   defaults to `./data` and resolves from the `server` directory. SQLite runs in WAL mode, so a
   backup must copy all three of `duels.db`, `duels.db-wal`, and `duels.db-shm`, and the server has
   to be stopped while you copy. Under `docker compose` the same three files live next to
   `./data/duels.db` on the host.

Only roster sync needs internet. Everything else works on the gym wifi alone.

## Run in the cloud

The same codebase deploys to Vercel. `api/index.ts` wraps the identical Hono app as a serverless
function; `vercel.json` builds the web SPA as static output and routes `/api/*` to the function.
Storage is Turso (libsql) instead of a local file; PIN auth, scoring, roster sync, and the
snapshot endpoint are unchanged.

Set these as Vercel project environment variables:

- `ADMIN_PIN`: the same 6-digit PIN as LAN mode.
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`: the Turso database the function opens instead of a
  local file.
- `PUBLIC_URL`: the deployment's public origin, for example `https://www.eastonduels.com`.
  Returned by `/api/lan` so the Connect page and QR codes point at it instead of a LAN address.
- `WL_CLIENT_ID`, `WL_CLIENT_SECRET`, `WL_REGION`, `WL_BUSINESS`: WellnessLiving credentials for
  roster sync, same as LAN mode. Leave all four empty to run without roster sync.
- `WL_KIDS_CATEGORY`: optional. Overrides the default kids and IBJJF belts filter.
- `WL_SYNC_MAX_POLLS`: optional. Caps roster sync polling so a sync fits inside the function's
  `maxDuration`.
- `SYNC_DEADLINE_MS`: optional. Wall-clock budget for one roster sync across every location,
  default 280000 in cloud mode. When it runs out the sync answers with the `wl_error` envelope
  naming how many locations finished, instead of being killed at `maxDuration`. LAN mode has no
  budget unless this is set.
- `LEADERBOARD_SUPABASE_URL`, `LEADERBOARD_SUPABASE_KEY`: the easton-leaderboard Supabase project,
  for the ERP join. Leave both empty to skip it.

Cloud mode never migrates at boot. Before any deploy that includes a new migration, run
`npm run db:migrate` with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` pointed at the Turso
database, and let it finish before that deploy goes out. Deploying code that expects a migration
which has not run yet is the failure this order avoids.

After a deploy, run a smoke check against the live deployment:

```
SMOKE_BASE=<deployment url> SMOKE_PIN=<admin pin> npm run smoke:cloud
```

It checks health, PIN auth, event creation, a snapshot poll, and cleanup, and prints `PASS` or
`FAIL: <step>`.

## Develop

- `npm run dev` starts the server with reload. `npm test` runs the server tests.
- `npm run e2e` builds nothing; run `npm run build` first. It boots the server on port 8499, scores
  one match over HTTP, and polls the snapshot endpoint.
- Commits run `gitleaks protect --staged` through `.githooks/pre-commit` (`brew install gitleaks`).
- The repo uses npm workspaces. Install with `npm`, not `pnpm` or `yarn`; either writes a second
  lockfile that npm workspaces do not read.

## Layout

- `server/`: Hono API, SQLite via Drizzle (a local file in LAN mode, Turso/libsql in the cloud), a
  polled snapshot endpoint, WL roster sync, Hungarian matchmaker.
- `web/`: Vite and React SPA (admin, scorer, board).
- `api/index.ts`: Vercel function entry point that wraps the same Hono app for cloud deploys.

## Credits

The WellnessLiving client is a TypeScript port of the client in easton-leaderboard.
