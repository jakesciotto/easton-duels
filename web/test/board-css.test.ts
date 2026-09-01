import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

/**
 * The board's colour and size decisions live in board.css, where a type checker cannot
 * see them and a component test cannot either: jsdom applies no stylesheet. Every
 * arithmetic claim the brief makes about the far dialect is checked here against the
 * declarations themselves, at the 1920 x 1080 design stage the brief works in.
 */
// Read from disk rather than imported: vitest stubs every CSS module, `?raw` included,
// and under jsdom `import.meta.url` is an http URL, so the path is resolved from the cwd
// the suite was started in.
function boardCssPath(): string {
  for (const candidate of ['src/routes/board/board.css', 'web/src/routes/board/board.css']) {
    const full = resolvePath(process.cwd(), candidate)
    if (existsSync(full)) return full
  }
  throw new Error(`board.css not found from ${process.cwd()}`)
}

const css = readFileSync(boardCssPath(), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const CQH = 10.8 // 1 percent of a 1080px stage
const CQW = 19.2 // 1 percent of a 1920px stage
const SAFE_W = 1728 // 90cqw
const SAFE_H = 972 // 90cqh
// Geist Mono advances 0.6em, which is what makes 2ch of b2 the 168px score slot in 6.15.
const CH_EM = 0.6

type Vars = Record<string, string>

function ruleFor(selector: string): string | null {
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].split(',').map(s => s.trim()).includes(selector)) return match[2]
  }
  return null
}

function rule(selector: string): string {
  const body = ruleFor(selector)
  if (body === null) throw new Error(`board.css has no rule for ${selector}`)
  return body
}

function declIn(body: string, prop: string): string {
  const found = new RegExp(`(?:^|[;{\\n])\\s*${prop}\\s*:\\s*([^;]+);`).exec(body)
  if (!found) throw new Error(`no ${prop} in rule`)
  return found[1].replace(/\s+/g, ' ').trim()
}

function decl(selector: string, prop: string): string {
  return declIn(rule(selector), prop)
}

function customProperties(selector: string): Vars {
  const out: Vars = {}
  for (const match of rule(selector).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]] = match[2].replace(/\s+/g, ' ').trim()
  }
  return out
}

function resolve(expr: string, vars: Vars): string {
  let out = expr
  for (let pass = 0; pass < 8 && out.includes('var('); pass += 1) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (_, name: string) => {
      const value = vars[name]
      if (value === undefined) throw new Error(`board.css leaves ${name} undefined`)
      return `(${value})`
    })
  }
  return out
}

/** Evaluates a resolved length in px. `ch` needs the font size of the element it sits on. */
function px(expr: string, vars: Vars, fontSize = 0): number {
  const tokens = resolve(expr, vars).replace(/calc/g, '').match(/\d*\.?\d+(?:cqh|cqw|ch|px)?|[()+\-*/]/g)
  if (!tokens) throw new Error(`cannot evaluate "${expr}"`)
  let i = 0

  const factor = (): number => {
    const token = tokens[i]
    i += 1
    if (token === '(') {
      const value = expression()
      i += 1
      return value
    }
    const parsed = /^(\d*\.?\d+)(cqh|cqw|ch|px)?$/.exec(token)
    if (!parsed) throw new Error(`unexpected "${token}" in "${expr}"`)
    const n = Number(parsed[1])
    if (parsed[2] === 'cqh') return n * CQH
    if (parsed[2] === 'cqw') return n * CQW
    if (parsed[2] === 'ch') return n * CH_EM * fontSize
    return n
  }
  const term = (): number => {
    let value = factor()
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i]
      i += 1
      value = op === '*' ? value * factor() : value / factor()
    }
    return value
  }
  const expression = (): number => {
    let value = term()
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i]
      i += 1
      value = op === '+' ? value + term() : value - term()
    }
    return value
  }
  return expression()
}

const stage = customProperties('.b-stage')

function rowWidth(selector: string, vars: Vars = stage): number {
  const fontSize = px('var(--b2)', vars)
  const tracks = decl(selector, 'grid-template-columns').split(' ')
  const columns = tracks.reduce((sum, track) => sum + px(track, vars, fontSize), 0)
  return columns + px(decl('.b-row', 'padding-left'), vars)
}

describe('the far knob', () => {
  it('multiplies the type steps and leaves the safe frame exactly where it was', () => {
    // Scaling the safe layer scaled the composition with it, which at far 1.2 painted a
    // 2073.6 x 1166.4 board inside a stage that clips at 1920 x 1080.
    expect(rule('.b-safe')).not.toMatch(/transform/)
    expect(decl('.b-safe', 'inset')).toBe('5%')

    for (const step of ['--b1', '--b2', '--b3', '--b-plate', '--b-indent', '--b-code']) {
      expect(stage[step]).toContain('var(--far)')
    }
    const deep: Vars = { ...stage, '--far': '1.2' }
    expect(px('var(--b1)', deep)).toBeCloseTo(22 * CQH * 1.2, 6)
    expect(px('var(--b3)', deep)).toBeCloseTo(9 * CQH * 1.2, 6)
    // Composition budgets are stated in the safe frame and do not move with the knob.
    expect(px(decl('.b-band', 'height'), deep)).toBeCloseTo(56 * CQH, 6)
    expect(px(decl('.b-hero', 'height'), deep)).toBeCloseTo(31 * CQH, 6)
  })
})

describe('the mat ledger row', () => {
  it('fits inside the safe width, both with and without the clock track', () => {
    // 1ch resolves against the row's own b2 and reserved 84.24px for a numeral that
    // renders at b3 and occupies 58.32px, which overflowed the row by 21.07px.
    expect(px('var(--col-board-mat)', stage)).toBeCloseTo(58.32, 2)
    expect(rowWidth('.b-row')).toBeCloseTo(1723.15, 1)
    expect(rowWidth('.b-row-clock')).toBeCloseTo(1702.99, 1)
    expect(rowWidth('.b-row')).toBeLessThanOrEqual(SAFE_W)
    expect(rowWidth('.b-row-clock')).toBeLessThanOrEqual(SAFE_W)
  })
})

describe('the mat band', () => {
  function matGap(n: number): string {
    const specific = ruleFor(`[data-comp='mats'][data-mats='${n}'] .b-band`)
    const body = specific ?? rule("[data-comp='mats'] .b-band")
    return declIn(body, '--b-mat-gap')
  }

  it('holds every mat count the API accepts inside the 56cqh band', () => {
    const height = decl("[data-comp='mats'] .b-panel", 'height')
    const capHeight = 0.72 * px('var(--b3)', stage)
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const vars: Vars = { ...stage, '--mats': String(n), '--b-mat-gap': matGap(n) }
      const panel = px(height, vars)
      const gap = px(matGap(n), vars)
      expect(n * panel + (n - 1) * gap).toBeCloseTo(56 * CQH, 6)
      // A row that renders at all has to hold the cap height of its own step.
      expect(panel).toBeGreaterThanOrEqual(capHeight)
    }
  })

  it('spends the rest of a one or two mat panel on the queue', () => {
    const one: Vars = { ...stage, '--mats': '1', '--b-mat-gap': matGap(1) }
    const two: Vars = { ...stage, '--mats': '2', '--b-mat-gap': matGap(2) }
    const panel = decl("[data-comp='mats'] .b-panel", 'height')
    const line = px(decl('.b-next-line', 'height'), stage)
    expect(px(decl("[data-comp='mats'][data-mats='1'] .b-panel > .b-row", 'height'), one) + 4 * line)
      .toBeCloseTo(px(panel, one), 6)
    expect(px(decl("[data-comp='mats'][data-mats='2'] .b-panel > .b-row", 'height'), two) + line)
      .toBeCloseTo(px(panel, two), 6)
  })
})

describe('the data entry composition', () => {
  it('sums to the safe frame and keeps the score inside its own row', () => {
    const band = rule("[data-comp='entry'] .b-band")
    const footer = rule('.b-footer')
    const total = px(declIn(rule("[data-comp='entry'] .b-hero"), 'height'), stage)
      + px(declIn(band, 'margin-top'), stage)
      + px(declIn(band, 'height'), stage)
      + px(declIn(footer, 'margin-top'), stage)
      + px(declIn(footer, 'height'), stage)
    expect(total).toBeCloseTo(SAFE_H, 6)

    const row = px(decl("[data-comp='entry'] .b-row", 'height'), stage)
    expect(4 * row).toBeCloseTo(px(declIn(band, 'height'), stage), 6)
    // b2 at 0.78 sets a 10.14cqh box in a 10cqh row, which is the 0.14 the row was over.
    const lineHeight = Number(decl("[data-comp='entry'] .b-score", 'line-height'))
    expect(px('var(--b2)', stage) * lineHeight).toBeLessThanOrEqual(row)
  })
})

describe('the change cue', () => {
  it('is a transition and not a keyframe animation', () => {
    // 4.3 collapses every animation to a single frame under Reduce Motion and keeps
    // opacity transitions, and the board is the surface that rule exists to protect.
    expect(css).not.toMatch(/@keyframes/)
    expect(css).not.toMatch(/animation/)
    expect(decl('.b-fig > span', 'transition')).toMatch(/^opacity /)
    expect(decl('.b-fig > span', 'opacity')).toBe('0')
    expect(decl('.b-fig > .b-fig-on', 'opacity')).toBe('1')
  })
})

describe('the board greps in 5.1', () => {
  it('carries no hex literal and no console sized type', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/font-size:[^;]*\d(px|vw|vh)\b/)
  })

  it('spends no grey below --gray-10 beyond the two 6.15 and 2.5 name', () => {
    expect(css.match(/var\(--gray-[2-9]\)/g)).toBeNull()
    // The settled row background, the plate code text, and the letterbox bars outside
    // the stage, which 3.4 states in those words.
    expect(css.match(/var\(--gray-1\)/g)).toHaveLength(3)
    expect(decl('.b-row-settled', 'background')).toBe('var(--gray-1)')
    expect(decl('.b-code', 'color')).toBe('var(--gray-1)')
    expect(decl('.b-frame', 'background')).toBe('var(--gray-1)')
  })
})
