export function loadDotEnv(file: string): void {
  const before: Record<string, string | undefined> = { ...process.env }
  try {
    process.loadEnvFile(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const key of Object.keys(before)) {
    process.env[key] = before[key]
  }
}

export const DEV_DB_PATH = './data/dev.db'

/**
 * The dev server's database is a local file unless the operator says otherwise. A checkout
 * that carries the Turso credentials in .env would otherwise read and write production
 * from a laptop: on 2026-09-08 that migrated production hours before the release, and every
 * score typed in dev lands on the record the gym reads. DUELS_DEV_REMOTE=1 opts back into
 * .env's remote target for a look at real data; an explicit DB_PATH always wins. Returns
 * the local path in use, or null when the remote target is kept.
 */
export function applyDevDefaults(env: Record<string, string | undefined>): string | null {
  if (env.DUELS_DEV_REMOTE === '1') return null
  env.DB_PATH ??= DEV_DB_PATH
  return env.DB_PATH
}
