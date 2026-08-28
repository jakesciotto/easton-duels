import os from 'node:os'

export function lanIp(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address
    }
  }
  return '127.0.0.1'
}
