import { randomInt, timingSafeEqual } from 'node:crypto'

export function pinMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function validateAdminPin(value: string | undefined): string {
  if (!value || !/^\d{6}$/.test(value)) throw new Error('ADMIN_PIN must be exactly 6 digits')
  return value
}

export function randomMatCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0')
}
