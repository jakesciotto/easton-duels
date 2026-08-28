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
