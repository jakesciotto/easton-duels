/**
 * Lowercase, letters and digits only, with accents folded away. The common ground every
 * comparison runs on. Decomposing first means "Núñez-Ortiz" and "Nunez Ortiz" reduce to
 * the same string, because the combining marks and the separator both fall away.
 */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// A part of a name shorter than this narrows nothing: a `like` on two letters answers
// half the gym.
const MIN_TOKEN = 3

/**
 * The parts of a name worth searching WellnessLiving by: its alphabetic runs, lowercased,
 * each one both as typed and folded to ASCII when the two differ, so "Nuñez-Ortiz" is
 * looked for as nuñez, nunez and ortiz. Hyphens, spaces and punctuation all separate,
 * which is what catches the half of a hyphenated surname a roster leaves out.
 */
export function nameTokens(name: string): string[] {
  const out: string[] = []
  for (const part of name.split(/[^\p{L}]+/u)) {
    for (const token of [part.toLowerCase(), normalize(part)]) {
      if (token.length >= MIN_TOKEN && !out.includes(token)) out.push(token)
    }
  }
  return out
}

function bigrams(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

/**
 * Dice coefficient over character bigrams of the normalized strings, 0 to 1. A string
 * under two characters has no bigram, so the answer is 1 for an equal pair and 0
 * otherwise.
 */
export function dice(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 1
  if (na.length < 2 || nb.length < 2) return 0

  const bgA = bigrams(na)
  const bgB = bigrams(nb)
  const pool = [...bgB]
  let matches = 0
  for (const bg of bgA) {
    const i = pool.indexOf(bg)
    if (i === -1) continue
    matches++
    pool.splice(i, 1)
  }
  return (2 * matches) / (bgA.length + bgB.length)
}

/**
 * Kids sign up under one name and WellnessLiving holds another. The first entry of each
 * group is the canonical form; the rest fold onto it. A name belongs to one group only.
 */
export const NICKNAMES: string[][] = [
  ['alex', 'alexander', 'alejandro', 'alexandra'],
  ['ben', 'benjamin'],
  ['sam', 'samuel', 'samantha'],
  ['max', 'maximilian', 'maxwell'],
  ['nick', 'nicholas'],
  ['liz', 'elizabeth'],
  ['kate', 'katherine', 'katie'],
  ['mike', 'michael'],
  ['matt', 'matthew'],
  ['nate', 'nathan', 'nathaniel'],
  ['tony', 'anthony'],
  ['will', 'william'],
  ['josh', 'joshua'],
  ['jake', 'jacob'],
  ['zach', 'zachary'],
  ['ellie', 'eleanor'],
  ['abby', 'abigail'],
  ['gabe', 'gabriel'],
  ['izzy', 'isabella', 'isabel'],
  ['eli', 'elijah'],
  ['leo', 'leonardo'],
  ['danny', 'daniel'],
  ['chris', 'christopher'],
  ['andy', 'andrew'],
  ['joe', 'joseph'],
  ['tom', 'thomas'],
  ['jack', 'john'],
  ['charlie', 'charles'],
  ['ali', 'alison'],
  ['mia', 'amelia'],
]

const CANONICAL = new Map(NICKNAMES.flatMap(group => group.map(name => [name, group[0]] as const)))

/** The group's first entry, or the normalized first token when no group holds the name. */
export function canonicalFirst(first: string): string {
  // A hyphen is a space here too, so "Mary-Kate" and "Mary Kate" name one child.
  const token = normalize(first.trim().split(/[\s-]+/)[0] ?? '')
  return CANONICAL.get(token) ?? token
}

interface Named { firstName: string; lastName: string }

/**
 * The only rule that links by itself: the same last name, and the same canonical first
 * name. Middle names and initials are ignored, because a roster types them as often as
 * it leaves them out.
 */
export function exactName(a: Named, b: Named): boolean {
  return normalize(a.lastName) === normalize(b.lastName) && canonicalFirst(a.firstName) === canonicalFirst(b.firstName)
}

/**
 * How close two names are, 0 to 1. The whole name carries the score; a last name that
 * matches exactly adds a tenth, because a shared surname is worth more than the same
 * number of letters spread anywhere else.
 */
export function nameScore(a: Named, b: Named): number {
  const base = dice(`${a.firstName} ${a.lastName}`, `${b.firstName} ${b.lastName}`)
  const bonus = normalize(a.lastName) === normalize(b.lastName) ? 0.1 : 0
  return Math.min(1, base + bonus)
}

// A near match under the floor is not worth a person's attention. Two candidates inside
// the margin of each other are not one suggestion, they are a choice, so neither is
// offered.
export const SUGGEST_FLOOR = 0.6
export const SUGGEST_MARGIN = 0.05
