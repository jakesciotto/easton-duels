import { KIDS_BELTS } from '@shared/types'
import { dice, normalize } from './similarity'
import type { ManualKid, TeamRow } from './types'

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

export type Field = 'name' | 'first' | 'last' | 'age' | 'weight' | 'belt' | 'gender' | 'team'

export interface PasteLine { n: number; text: string; row: ManualKid | null; problem: string | null }
export interface PasteMapping { header: boolean; delimiter: 'tab' | 'comma'; columns: (Field | null)[]; ignored: string[] }

export const FIELD_LABEL: Record<Field, string> = {
  name: 'Name', first: 'First', last: 'Last', age: 'Age', weight: 'lb', belt: 'Belt', gender: 'Gender', team: 'Team',
}

const FIELD_ORDER: Field[] = ['name', 'first', 'last', 'age', 'weight', 'belt', 'gender', 'team']

const FIELD_ALIASES: Record<Field, string[]> = {
  name: ['name', 'full name', 'competitor', 'student', 'athlete', 'kid', 'child'],
  first: ['first', 'first name', 'given name'],
  last: ['last', 'last name', 'surname', 'family name'],
  age: ['age', 'years', 'yrs'],
  weight: ['weight', 'wt', 'lb', 'lbs', 'pounds', 'weight lbs'],
  belt: ['belt', 'rank', 'belt rank', 'grade'],
  gender: ['gender', 'sex', 'm/f'],
  team: ['team', 'side', 'squad'],
}

const POSITIONAL_COLUMNS: (Field | null)[] = ['name', 'age', 'weight', 'belt', 'gender']

const BARE_NUMBER = /^\d+(\.\d+)?$/

function isBareNumber(cell: string): boolean {
  return BARE_NUMBER.test(cell.trim())
}

function bestField(cell: string): { field: Field; score: number } {
  let best: { field: Field; score: number } = { field: FIELD_ORDER[0], score: -1 }
  for (const field of FIELD_ORDER) {
    const score = Math.max(...FIELD_ALIASES[field].map(alias => dice(cell, alias)))
    if (score > best.score) best = { field, score }
  }
  return best
}

function detectHeader(cells: string[]): boolean {
  if (cells.some(isBareNumber)) return false
  return cells.some(c => bestField(c).score >= 0.8)
}

function buildMapping(cells: string[]): { columns: (Field | null)[]; ignored: string[] } {
  const candidates = cells.map(bestField)
  const columns: (Field | null)[] = candidates.map(c => (c.score >= 0.6 ? c.field : null))

  // A field takes at most one column: the column with the higher score keeps it.
  const bestColumnForField = new Map<Field, number>()
  columns.forEach((field, i) => {
    if (!field) return
    const holder = bestColumnForField.get(field)
    if (holder === undefined || candidates[holder].score < candidates[i].score) bestColumnForField.set(field, i)
  })

  const resolved = columns.map((field, i) => (field !== null && bestColumnForField.get(field) === i ? field : null))
  const ignored = cells.filter((_, i) => resolved[i] === null).map(c => c.trim())
  return { columns: resolved, ignored }
}

function matchTeam(raw: string, teams: TeamRow[]): TeamRow | null {
  const key = normalize(raw)
  const exact = teams.find(t => normalize(t.name) === key)
  if (exact) return exact

  let best: { team: TeamRow; score: number } | null = null
  for (const team of teams) {
    const score = dice(raw, team.name)
    if (!best || score > best.score) best = { team, score }
  }
  return best && best.score >= 0.5 ? best.team : null
}

function buildRow(values: Partial<Record<Field, string>>, teams: TeamRow[]): { row: ManualKid | null; problem: string | null } {
  let firstName: string
  let lastName: string
  if (values.name !== undefined) {
    const words = values.name.split(/\s+/).filter(Boolean)
    if (words.length < 2) return { row: null, problem: 'needs a first and last name' }
    lastName = words[words.length - 1]
    firstName = words.slice(0, -1).join(' ')
  } else {
    const first = values.first ?? ''
    const last = values.last ?? ''
    if (!first || !last) return { row: null, problem: 'needs a first and last name' }
    firstName = first
    lastName = last
  }

  let age: number | null = null
  if (values.age) {
    age = Number(values.age)
    if (!Number.isInteger(age)) return { row: null, problem: 'age must be a number' }
    if (age < 3 || age > 17) return { row: null, problem: 'age must be between 3 and 17' }
  }

  let weightLbs: number | null = null
  if (values.weight) {
    const stripped = values.weight.replace(/\s*(lbs?|pounds)$/i, '')
    weightLbs = Math.round(Number(stripped))
    if (!Number.isFinite(weightLbs)) return { row: null, problem: 'weight must be a number' }
    if (weightLbs < 20 || weightLbs > 250) return { row: null, problem: 'weight must be between 20 and 250' }
  }

  let belt: string | null = null
  if (values.belt) {
    const b = parseBelt(values.belt)
    if (b instanceof Error) return { row: null, problem: b.message }
    belt = b
  }

  const gender = values.gender ? values.gender.charAt(0).toUpperCase() : null

  const row: ManualKid = { firstName, lastName, age, weightLbs, belt, gender }

  if (values.team !== undefined) {
    if (values.team === '') {
      row.teamId = null
    } else {
      const team = matchTeam(values.team, teams)
      if (!team) return { row: null, problem: `unknown team "${values.team}"` }
      row.teamId = team.id
    }
  }

  return { row, problem: null }
}

function fieldValues(cells: string[], columns: (Field | null)[]): Partial<Record<Field, string>> {
  const values: Partial<Record<Field, string>> = {}
  columns.forEach((field, i) => {
    if (!field) return
    values[field] = (cells[i] ?? '').trim()
  })
  return values
}

export function parseRosterPaste(text: string, teams: TeamRow[] = []): { lines: PasteLine[]; rows: ManualKid[]; errors: string[]; mapping: PasteMapping } {
  const significant = text.split(/\r?\n/)
    .map((t, i) => ({ n: i + 1, text: t }))
    .filter(l => l.text.trim() !== '')

  if (significant.length === 0) {
    return { lines: [], rows: [], errors: [], mapping: { header: false, delimiter: 'comma', columns: POSITIONAL_COLUMNS, ignored: [] } }
  }

  const delimiter: 'tab' | 'comma' = significant[0].text.includes('\t') ? 'tab' : 'comma'
  const splitCells = (line: string) => line.split(delimiter === 'tab' ? '\t' : ',').map(c => c.trim())

  const firstCells = splitCells(significant[0].text)
  const header = detectHeader(firstCells)

  let mapping: PasteMapping
  let dataLines: { n: number; text: string }[]

  if (header) {
    const { columns, ignored } = buildMapping(firstCells)
    mapping = { header: true, delimiter, columns, ignored }
    dataLines = significant.slice(1)
  } else {
    mapping = { header: false, delimiter, columns: POSITIONAL_COLUMNS, ignored: [] }
    dataLines = significant
  }

  const hasName = mapping.columns.includes('name') || (mapping.columns.includes('first') && mapping.columns.includes('last'))

  const lines: PasteLine[] = []
  const errors: string[] = []

  for (const { n, text: lineText } of dataLines) {
    let result: { row: ManualKid | null; problem: string | null }
    if (!hasName) {
      result = { row: null, problem: 'needs a name column' }
    } else {
      const cells = splitCells(lineText)
      const values = header
        ? fieldValues(cells, mapping.columns)
        : fieldValues(cells, POSITIONAL_COLUMNS)
      result = buildRow(values, teams)
    }
    lines.push({ n, text: lineText, row: result.row, problem: result.problem })
    if (result.problem) errors.push(`line ${n}: ${result.problem}`)
  }

  const rows = errors.length ? [] : lines.map(l => l.row as ManualKid)

  return { lines, rows, errors, mapping }
}
