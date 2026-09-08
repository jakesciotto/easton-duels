export interface BoardNameParts { first: string; last: string }

/**
 * First name plus last initial, unconditionally, at every mat count.
 *
 * This is a legibility rule, not the privacy fix. Since v0.7.3 the snapshot itself
 * carries a first name and a last initial for every caller without an admin token, so
 * what arrives here is already "Mateo R." and this split only lays it out; it still
 * handles a full name, because the console's stream holds a token and gets one.
 *
 * The two parts are returned separately because the field truncates from the
 * first name and keeps the initial, which CSS can only do across two elements.
 */
export function boardName(full: string): BoardNameParts {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  const surname = parts[parts.length - 1]
  return { first: parts[0], last: `${surname.charAt(0).toUpperCase()}.` }
}

export function boardNameText(full: string): string {
  const { first, last } = boardName(full)
  return last ? `${first} ${last}` : first
}
