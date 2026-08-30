import os from 'node:os'

// Lower is better. An iPad on the gym wifi can only reach a private LAN address, so a
// Tailscale CGNAT address (the first interface on a laptop with Tailscale up) is a last
// resort and a link-local address is never usable.
function rank(address: string): number {
  const [a, b] = address.split('.').map(Number)
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 0
  if (a === 169 && b === 254) return 3
  if (a === 100 && b >= 64 && b <= 127) return 2
  return 1
}

export function lanIp(): string {
  let best: { rank: number; address: string } | null = null
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      const r = rank(i.address)
      if (r === 0) return i.address
      if (r < 3 && (best === null || r < best.rank)) best = { rank: r, address: i.address }
    }
  }
  return best?.address ?? '127.0.0.1'
}
