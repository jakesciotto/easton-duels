export function ageFromAgeGroup(ageGroup: string | null): number | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(ageGroup ?? '')
  return m ? Number(m[1]) : null
}

export function weightFromWeightClass(weightClass: string | null): number | null {
  const m = /(\d+(?:\.\d+)?)\s*\+?\s*(lbs?|kg)/i.exec(weightClass ?? '')
  if (!m) return null
  const n = Number(m[1])
  return Math.round(m[2].toLowerCase() === 'kg' ? n * 2.20462 : n)
}
