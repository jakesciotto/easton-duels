import { KIDS_BELTS, type KidsBelt } from '../shared/types.js'

// s_sql keywords must be lowercase; WL returns "Unknown SQL statement" for SELECT.
export const KIDS_QUERY =
  "select uid, text_rank, text_rank_category, `o_client.text_first`, `o_client.text_last`, `o_rank_promotion_date.dtl_promotion_date` " +
  "where text_rank <> 'No belt' and text_rank_category like '%Kids%'"

export function normalizeTitle(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

const COMPOUND: Record<string, KidsBelt> = {
  'gray/white': 'grey-white', 'grey/white': 'grey-white',
  'gray/black': 'grey-black', 'grey/black': 'grey-black',
  'yellow/white': 'yellow-white', 'yellow/black': 'yellow-black',
  'orange/white': 'orange-white', 'orange/black': 'orange-black',
  'green/white': 'green-white', 'green/black': 'green-black',
}
const SIMPLE: Record<string, KidsBelt> = {
  white: 'white', gray: 'grey', grey: 'grey', yellow: 'yellow', orange: 'orange', green: 'green',
}

export function deriveKidsBelt(rankTitle: string): KidsBelt | null {
  const head = String(rankTitle ?? '').split('-')[0].toLowerCase().replace(/\bbelts?\b/g, '').replace(/\s+/g, ' ').trim()
  const belt = COMPOUND[head] ?? SIMPLE[head] ?? null
  return belt && (KIDS_BELTS as readonly string[]).includes(belt) ? belt : null
}
