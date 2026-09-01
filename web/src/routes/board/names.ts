export interface BoardNameParts { first: string; last: string }

/**
 * First name plus last initial, unconditionally, at every mat count.
 *
 * This is a LEGIBILITY change and it does NOT close the privacy item.
 * `/api/events/:id/snapshot` is public, unauthenticated, and still serves every
 * child's full name to anyone with curl, so truncating in the browser closes
 * nothing. The fix is a server change in the snapshot serializer.
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
