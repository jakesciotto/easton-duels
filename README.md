# Easton Duels

Scores a two-team kids jiu jitsu and wrestling duel on a gym LAN. One laptop runs the server.
iPads at the mat tables score matches. A TV shows team wins and points live.

## Run at the gym

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

## Develop

- `npm run dev` starts the server with reload. `npm test` runs the server tests.
- `npm run e2e` builds nothing; run `npm run build` first. It boots the server on port 8499, scores
  one match over HTTP, and reads the SSE stream.
- Commits run `gitleaks protect --staged` through `.githooks/pre-commit` (`brew install gitleaks`).
- The repo uses npm workspaces. Install with `npm`, not `pnpm` or `yarn`; either writes a second
  lockfile that npm workspaces do not read.

## Layout

- `server/`: Hono API, SQLite via Drizzle, SSE snapshot fan-out, WL roster sync, Hungarian matchmaker.
- `web/`: Vite and React SPA (admin, scorer, board).

## Credits

The WellnessLiving client is a TypeScript port of the client in easton-leaderboard.
