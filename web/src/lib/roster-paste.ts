import { KIDS_BELTS } from '@shared/types'
import type { ManualKid } from './types'

const BELT_ALIASES: Record<string, string> = {
  gray: 'grey', 'gray/white': 'grey-white', 'grey/white': 'grey-white', 'gray/black': 'grey-black', 'grey/black': 'grey-black',
  'yellow/white': 'yellow-white', 'yellow/black': 'yellow-black', 'orange/white': 'orange-white', 'orange/black': 'orange-black',
  'green/white': 'green-white', 'green/black': 'green-black',
}

function parseBelt(raw: string): string | null | Error {
  const key = raw.toLowerCase().replace(/\s+/g, '').replace(/belt$/, '')
  const belt = BELT_ALIASES[key] ?? key
  if ((KIDS_BELTS as readonly string[]).includes(belt)) return belt
  return new Error(`unknown belt "${raw}"`)
}

export function parseRosterPaste(text: string): { rows: ManualKid[]; errors: string[] } {
  const rows: ManualKid[] = []
  const errors: string[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const n = i + 1
    if (!line.trim()) return
    const [name = '', ageRaw = '', weightRaw = '', beltRaw = '', genderRaw = ''] = line.split(',').map(s => s.trim())
    const words = name.split(/\s+/).filter(Boolean)
    if (words.length < 2) return errors.push(`line ${n}: needs a first and last name`)
    const lastName = words[words.length - 1]
    const firstName = words.slice(0, -1).join(' ')
    let age: number | null = null
    if (ageRaw) {
      age = Number(ageRaw)
      if (!Number.isInteger(age)) return errors.push(`line ${n}: age must be a number`)
      if (age < 3 || age > 17) return errors.push(`line ${n}: age must be between 3 and 17`)
    }
    let weightLbs: number | null = null
    if (weightRaw) {
      weightLbs = Math.round(Number(weightRaw))
      if (!Number.isFinite(weightLbs)) return errors.push(`line ${n}: weight must be a number`)
      if (weightLbs < 20 || weightLbs > 250) return errors.push(`line ${n}: weight must be between 20 and 250`)
    }
    let belt: string | null = null
    if (beltRaw) {
      const b = parseBelt(beltRaw)
      if (b instanceof Error) return errors.push(`line ${n}: ${b.message}`)
      belt = b
    }
    const gender = genderRaw ? genderRaw.charAt(0).toUpperCase() : null
    rows.push({ firstName, lastName, age, weightLbs, belt, gender })
  })
  return { rows: errors.length ? [] : rows, errors }
}
