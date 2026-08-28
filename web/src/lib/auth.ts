const ADMIN_KEY = 'duels:admin-token'
const MAT_KEY = 'duels:mat'

export interface MatBinding { eventId: number; matId: number; matNumber: number; eventName: string; token: string }

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* storage blocked */ }
}

const listeners = new Set<() => void>()
export function subscribeAdminToken(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
const notify = () => { for (const cb of listeners) cb() }

export const getAdminToken = () => read(ADMIN_KEY)
export const setAdminToken = (token: string) => { write(ADMIN_KEY, token); notify() }
export const clearAdminToken = () => { write(ADMIN_KEY, null); notify() }

export function getMatBinding(): MatBinding | null {
  const raw = read(MAT_KEY)
  if (!raw) return null
  try {
    const b = JSON.parse(raw) as MatBinding
    return typeof b.matId === 'number' && typeof b.token === 'string' ? b : null
  } catch {
    return null
  }
}
export const setMatBinding = (b: MatBinding) => write(MAT_KEY, JSON.stringify(b))
export const clearMatBinding = () => write(MAT_KEY, null)
