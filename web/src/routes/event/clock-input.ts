export const MIN_LENGTH_SEC = 30
export const MAX_LENGTH_SEC = 1800

/**
 * 6.7a's m:ss mask. The number a ruleset sets is the same object the board renders, so
 * it is authored in the board's own form rather than in seconds. Digits fill from the
 * right, so 500 becomes 5:00 and there is never an ambiguous bare number to interpret.
 */
export function maskClock(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  return digits.length <= 2 ? digits : `${digits.slice(0, digits.length - 2)}:${digits.slice(digits.length - 2)}`
}

/** Null means the field cannot be committed, which is also what disables Save. */
export function clockToSec(text: string): number | null {
  const pair = /^(\d{1,2}):([0-5]\d)$/.exec(text)
  const total = pair ? Number(pair[1]) * 60 + Number(pair[2]) : /^\d{1,2}$/.test(text) ? Number(text) : null
  if (total === null) return null
  return total >= MIN_LENGTH_SEC && total <= MAX_LENGTH_SEC ? total : null
}
