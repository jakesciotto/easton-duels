import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { B1, B2, B3, HERO_GAP, PLATE, boardBudget } from '@/routes/board/budget'

/**
 * The board's colour and size decisions live in board.css, where a type checker cannot
 * see them and a component test cannot either: jsdom applies no stylesheet. Every
 * arithmetic claim the brief makes about the far dialect is checked here against the
 * declarations themselves, at the 1920 x 1080 design stage the brief works in.
 *
 * The vertical budget is budget.ts's and is tested in board-budget.test.ts. What is
 * checked here is that the stylesheet consumes those numbers and that the horizontal
 * frame, which is entirely CSS's, holds at every --far setting 3.4 documents.
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
// Geist Mono advances 0.6em, which is what makes 2ch of b2 the 168px score slot in 6.15.
const CH_EM = 0.6
const FARS = [0.85, 1, 1.2]

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
  for (let pass = 0; pass < 12 && out.includes('var('); pass += 1) {
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
  const tokens = resolve(expr, vars).replace(/calc/g, '')
    .match(/min|max|clamp|\d*\.?\d+(?:cqh|cqw|ch|px)?|[(),+\-*/]/g)
  if (!tokens) throw new Error(`cannot evaluate "${expr}"`)
  let i = 0

  const factor = (): number => {
    const token = tokens[i]
    i += 1
    if (token === 'min' || token === 'max' || token === 'clamp') {
      i += 1 // the opening paren
      const args = [expression()]
      while (tokens[i] === ',') {
        i += 1
        args.push(expression())
      }
      i += 1 // the closing paren
      if (token === 'min') return Math.min(...args)
      if (token === 'max') return Math.max(...args)
      return Math.min(Math.max(args[0], args[1]), args[2])
    }
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

/** The stage's type steps, the safe layer's budget defaults, and the row's own tracks. */
function boardVars(far: number): Vars {
  return {
    ...customProperties('.b-stage'),
    ...customProperties('.b-safe'),
    ...customProperties('.b-row'),
    '--far': String(far),
  }
}

/**
 * The fixed tracks of a row and the number of `minmax(0, 1fr)` name tracks beside them.
 * A flexible track has no width of its own: it is whatever the row has left.
 */
function rowTracks(selector: string, far: number): { fixed: number; flexible: number } {
  const vars = boardVars(far)
  const fontSize = px(decl('.b-row', 'font-size'), vars)
  const tracks = decl(selector, 'grid-template-columns').replace(/minmax\(0, 1fr\)/g, 'FLEX').split(' ')
  const flexible = tracks.filter(track => track === 'FLEX').length
  const fixed = tracks
    .filter(track => track !== 'FLEX')
    .reduce((sum, track) => sum + px(track, vars, fontSize), 0)
  return { fixed: fixed + px(decl('.b-row', 'padding-left'), vars), flexible }
}

describe('the far knob', () => {
  it('multiplies the type steps and leaves the safe frame exactly where it was', () => {
    // Scaling the safe layer scaled the composition with it, which at far 1.2 painted a
    // 2073.6 x 1166.4 board inside a stage that clips at 1920 x 1080.
    expect(rule('.b-safe')).not.toMatch(/transform/)
    expect(decl('.b-safe', 'inset')).toBe('5%')

    for (const step of ['--b1', '--b2', '--b3', '--b-plate', '--b-indent', '--b-code',
      '--b-gap-row', '--b-gap-tight', '--b-gap-pair']) {
      expect(customProperties('.b-stage')[step], step).toContain('var(--far)')
    }
    const deep = boardVars(1.2)
    expect(px('var(--b1)', deep)).toBeCloseTo(B1 * CQH * 1.2, 6)
    expect(px('var(--b2)', deep)).toBeCloseTo(B2 * CQH * 1.2, 6)
    expect(px('var(--b3)', deep)).toBeCloseTo(B3 * CQH * 1.2, 6)
  })

  it('scales the hero band and the leading inside it together', () => {
    // The defect: a fixed 31cqh hero around contents that scaled meant turning the deep
    // room knob UP squeezed the plate row, which is the one flexible item, and clipped
    // the team name. The plate row no longer flexes and the band comes from the budget.
    expect(decl('.b-hero', 'height')).toBe('calc(var(--b-hero-n) * 1cqh)')
    expect(decl('.b-band', 'height')).toBe('calc(var(--b-band-n) * 1cqh)')
    expect(decl('.b-band', 'margin-top')).toBe('calc(var(--b-hero-gap-n) * 1cqh)')
    expect(decl('.b-plate-row', 'flex')).toBe('none')
    for (const [selector, prop] of [
      ['.b-bar', 'height'], ['.b-plate-row', 'margin-top'], ['.b-score-row', 'margin-top'],
    ] as const) {
      expect(decl(selector, prop), `${selector} ${prop}`).toContain('var(--far)')
    }
  })

  it('states the same type steps and plates the budget module works from', () => {
    // Two files carry these numbers, so a change to one has to break the other.
    const at1 = boardVars(1)
    expect(px('var(--b1)', at1)).toBeCloseTo(B1 * CQH, 6)
    expect(px('var(--b2)', at1)).toBeCloseTo(B2 * CQH, 6)
    expect(px('var(--b3)', at1)).toBeCloseTo(B3 * CQH, 6)
    expect(px('var(--b-plate)', at1)).toBeCloseTo(PLATE.mats * CQH, 6)
    expect(px(declIn(rule("[data-comp='entry'] .b-hero"), '--b-plate'), at1)).toBeCloseTo(PLATE.entry * CQH, 6)
    expect(px(declIn(rule("[data-comp='done'] .b-hero"), '--b-plate'), at1)).toBeCloseTo(PLATE.done * CQH, 6)
    // The stylesheet's own defaults are the live composition at far 1, one mat, no note.
    const live = boardBudget({ comp: 'mats', mats: 1, far: 1, note: false })
    const safe = customProperties('.b-safe')
    expect(Number(safe['--b-hero-n'])).toBeCloseTo(live.hero, 6)
    expect(Number(safe['--b-band-n'])).toBeCloseTo(live.band, 6)
    expect(Number(safe['--b-hero-gap-n'])).toBe(HERO_GAP.mats)
  })
})

describe('the hero figures', () => {
  it('gives both hero numerals a character slot, points included', () => {
    // 2.8: a fixed slot, so a value change can never change the width of its container.
    // The points figure was the one board number without one. At a 1920 stage a b3
    // character is 58.32px, so a team taking a 2 point takedown from 9 grew its label
    // box by that much in one frame and shoved " pts" sideways on a still hero half.
    const vars = boardVars(1)
    const b1 = px(decl('.b-wins', 'font-size'), vars)
    const b3 = px('var(--b3)', vars)
    expect(px(decl('.b-wins', 'min-width'), vars, b1)).toBeCloseTo(2 * CH_EM * b1, 6)
    expect(decl('.b-pts', 'display')).toBe('inline-block')
    expect(px(decl('.b-pts', 'min-width'), vars, b3)).toBeCloseTo(3 * CH_EM * b3, 6)
    // Three characters, because a team's points total passes 99 in a full event.
    expect(3 * CH_EM * b3).toBeCloseTo(174.96, 2)
    // One rule for the live box and the cold start box, so the two cannot drift apart.
    expect(css).not.toMatch(/b-cold-pts/)
  })

  it('states the alignment inside the points slot instead of inheriting two of them', () => {
    // The two halves do not inherit the same alignment: half B sets text-align: right and
    // half A leaves it at the start. A slot with no rule of its own therefore put a single
    // digit hard against " pts" on one half and two blank characters away from it on the
    // other, which is 116.64px at the design stage on a hero that is meant to mirror.
    expect(decl('.b-half-b', 'text-align')).toBe('right')
    expect(ruleFor('.b-half')).not.toMatch(/text-align/)
    expect(decl('.b-pts', 'text-align')).toBe('right')
    expect(2 * CH_EM * px('var(--b3)', boardVars(1))).toBeCloseTo(116.64, 2)
  })
})

describe('the mat ledger row', () => {
  it('fits inside the safe width at every far, with and without the clock track', () => {
    // The defect: --bn was a fixed 31.2cqw name token beside tracks that scale with the
    // knob, so at far 1.2 the four mat ledger came to 1807.39px against 1728px of safe
    // width and clipped competitor names with no ellipsis. The name tracks are now the
    // flexible ones, which is 6.15's "names truncate, they never shrink".
    expect(css).not.toMatch(/--bn\b/)
    for (const far of FARS) {
      for (const selector of ['.b-row', '.b-row-clock']) {
        const { fixed, flexible } = rowTracks(selector, far)
        const where = `${selector} at far ${far}`
        expect(flexible, where).toBe(2)
        expect(fixed, where).toBeLessThanOrEqual(SAFE_W)
        expect((SAFE_W - fixed) / 2, where).toBeGreaterThan(0)
      }
    }
  })

  it('holds 6.15 arithmetic exactly at the design stage', () => {
    // 1ch of the row's own step reserved a score sized slot for a numeral that renders
    // at the name step, which overflowed the row by 21.07px.
    expect(px('var(--col-board-mat)', boardVars(1), 0)).toBeCloseTo(58.32, 2)
    const ledger = rowTracks('.b-row', 1)
    const clock = rowTracks('.b-row-clock', 1)
    expect(ledger.fixed).toBeCloseTo(525.1, 1)
    expect(clock.fixed).toBeCloseTo(862.06, 1)
    // 601px of name per side is the field 6.15 measured its five test names against.
    expect((SAFE_W - ledger.fixed) / 2).toBeCloseTo(601.45, 1)
    expect((SAFE_W - clock.fixed) / 2).toBeCloseTo(432.97, 1)
    // Every fixed track is type, so the whole row scales as one thing.
    expect(rowTracks('.b-row', 1.2).fixed).toBeCloseTo(ledger.fixed * 1.2, 6)
    expect(rowTracks('.b-row-clock', 0.85).fixed).toBeCloseTo(clock.fixed * 0.85, 6)
  })

  it('steps a row down to the room it has rather than clipping it', () => {
    // At six mats the panel is 96.3px and a fixed b2 score line box is 140.4px, so 22px
    // came off each end of every digit.
    const sixMats: Vars = { ...boardVars(1), '--b-row-n': String(boardBudget({ comp: 'mats', mats: 6, far: 1, note: false }).row) }
    expect(px('var(--b-score-step)', sixMats)).toBeCloseTo(B3 * CQH, 6)
    expect(px('var(--b-name-step)', sixMats)).toBeCloseTo(B3 * CQH, 6)
    expect(px('var(--b-score-step)', boardVars(1))).toBeCloseTo(B2 * CQH, 6)
    for (const selector of ['.b-row', '.b-score', '.b-clock']) {
      expect(decl(selector, 'font-size'), selector).toBe('var(--b-score-step)')
    }
    for (const selector of ['.b-name', '.b-mat']) {
      expect(decl(selector, 'font-size'), selector).toBe('var(--b-name-step)')
    }
  })
})

describe('the note', () => {
  it('takes a line of the composition instead of painting over one', () => {
    // As an overlay it covered the bottom 97.2px of the safe area, which on a four mat
    // board is most of mat 4's own name line, at the moment somebody is reading it.
    const body = rule('.b-note')
    expect(body).not.toMatch(/position\s*:/)
    expect(body).not.toMatch(/background\s*:/)
    expect(declIn(body, 'flex')).toBe('none')
    expect(px(declIn(body, 'height'), boardVars(1))).toBeCloseTo(B3 * CQH, 6)
    expect(px(declIn(body, 'margin-top'), boardVars(1))).toBeCloseTo(CQH, 6)
    // The stale bar is the colour channel and it stays in the letterbox margin.
    expect(decl('.b-stale', 'position')).toBe('absolute')
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
