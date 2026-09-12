import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { B1, B2, B3, HERO_GAP, SAFE_CQH, SETUP_HEAD_GAP, boardBudget, lbGapFor, lbRowFor } from '@/routes/board/budget'
import type { Composition } from '@/routes/board/plan'

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
// " pts" is Geist, not Geist Mono, and its four characters average about half an em.
const PTS_EM = 0.5
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
 * The same, with the hero's own steps resolved for a team count: the budget states
 * --b-hero-n, --lb-rows and --lb-gap-n on the safe layer, and .b-lb derives the row and
 * both type steps from them.
 */
function lbVars(far: number, teams: number, comp: Composition = 'mats', sign = false): Vars {
  const budget = boardBudget({ comp, mats: 2, teams, far, note: false, sign })
  return {
    ...boardVars(far),
    ...customProperties('.b-lb'),
    ...customProperties('.lb-row'),
    '--b-hero-n': String(budget.hero),
    '--lb-rows': String(budget.lbRows),
    '--lb-gap-n': String(budget.lbGap),
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

    for (const step of ['--b1', '--b2', '--b3', '--b-indent',
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
    // room knob UP squeezed the one flexible item and clipped the team name. Nothing in
    // the hero flexes now: the rows divide --b-hero-n, which the budget states.
    expect(decl('.b-lb', 'height')).toBe('calc(var(--b-hero-n) * 1cqh)')
    expect(decl('.b-lb', 'flex')).toBe('none')
    expect(decl('.lb-row', 'flex')).toBe('none')
    expect(decl('.b-band', 'height')).toBe('calc(var(--b-band-n) * 1cqh)')
    expect(decl('.b-band', 'margin-top')).toBe('calc(var(--b-hero-gap-n) * 1cqh)')
    // The two-half hero is retired, so none of its geometry is left to drift.
    for (const gone of ['.b-hero', '.b-half', '.b-bar', '.b-plate-row', '.b-code', '.b-score-row', '.b-wins', '.b-labels', '.b-pts']) {
      expect(ruleFor(gone), gone).toBeNull()
    }
    expect(css).not.toMatch(/--b-plate|--b-code|--b-wins-box/)
  })

  it('states the same type steps and plates the budget module works from', () => {
    // Two files carry these numbers, so a change to one has to break the other.
    const at1 = boardVars(1)
    expect(px('var(--b1)', at1)).toBeCloseTo(B1 * CQH, 6)
    expect(px('var(--b2)', at1)).toBeCloseTo(B2 * CQH, 6)
    expect(px('var(--b3)', at1)).toBeCloseTo(B3 * CQH, 6)
    // The stylesheet's own defaults are the live composition at far 1, two teams, one
    // mat, no note.
    const live = boardBudget({ comp: 'mats', mats: 1, teams: 2, far: 1, note: false })
    const safe = customProperties('.b-safe')
    expect(Number(safe['--b-hero-n'])).toBeCloseTo(live.hero, 6)
    expect(Number(safe['--b-band-n'])).toBeCloseTo(live.band, 6)
    expect(Number(safe['--b-hero-gap-n'])).toBe(HERO_GAP.mats)
    expect(Number(safe['--lb-rows'])).toBe(live.lbRows)
    expect(Number(safe['--lb-gap-n'])).toBeCloseTo(live.lbGap, 6)
  })
})

describe('the hero figures', () => {
  it('gives every standing figure a character slot, points included', () => {
    // 2.8: a fixed slot, so a value change can never change the width of its container.
    // The points figure was the one board number without one. At a 1920 stage a b3
    // character is 58.32px, so a team taking a 2 point takedown from 9 grew its label
    // box by that much in one frame and shoved " pts" sideways on a still hero.
    const vars = lbVars(1, 2)
    const wins = px('var(--lb-wins)', vars)
    const name = px('var(--lb-name)', vars)
    expect(px(declIn(rule('.lb-row'), '--lb-col-wins'), vars, wins)).toBeCloseTo(2 * CH_EM * wins, 6)
    expect(decl('.lb-pts-n', 'display')).toBe('inline-block')
    expect(px(decl('.lb-pts-n', 'min-width'), vars, name)).toBeCloseTo(3 * CH_EM * name, 6)
    // Three characters, because a team's points total passes 99 in a full event.
    expect(3 * CH_EM * name).toBeCloseTo(174.96, 2)
    expect(decl('.lb-pts-n', 'text-align')).toBe('right')
    // One rule for the live box and the cold start box, so the two cannot drift apart.
    expect(css).not.toMatch(/b-cold-pts/)
  })

  it('puts the rank numeral on the track the mat numeral uses', () => {
    // Both are 0.6 of the step beside them, so the standings and the ledger below them
    // read down one column rather than two that nearly line up.
    const vars = lbVars(1, 3)
    expect(px(declIn(rule('.lb-row'), '--lb-col-rank'), vars))
      .toBeCloseTo(px('var(--col-board-mat)', { ...vars, '--b-name-step': 'var(--lb-name)' }), 6)
    expect(decl('.lb-rank', 'font-size')).toBe('var(--lb-name)')
    expect(decl('.lb-rank', 'text-align')).toBe('center')
  })

  it('takes the second half of the leading indent for the team edge, costing no column', () => {
    expect(decl('.lb-edge', 'position')).toBe('absolute')
    expect(decl('.lb-edge', 'left')).toBe('var(--b-edge-w)')
    expect(decl('.lb-edge', 'width')).toBe('var(--b-edge-w)')
    expect(decl('.lb-edge', 'background')).toBe('var(--team)')
    expect(decl('.lb-edge', 'top')).toBe('0')
    expect(decl('.lb-edge', 'bottom')).toBe('0')
    // The row reserves exactly two edges of indent on the leading side, as a mat row does.
    for (const far of FARS) {
      const vars = lbVars(far, 3)
      expect(px(decl('.lb-row', 'padding-left'), vars), `far ${far}`).toBeCloseTo(2 * px('var(--b-edge-w)', vars), 6)
      expect(decl('.lb-row', 'padding-right')).toBe('var(--b-indent)')
    }
  })

  it('tones a tied leader on the figure and the numeral, and nowhere else', () => {
    expect(decl('.lb-lead .lb-wins', 'color')).toBe('var(--fig-lead)')
    expect(decl('.lb-lead .lb-rank', 'color')).toBe('var(--gray-12)')
    expect(decl('.lb-wins', 'color')).toBe('var(--fig-trail)')
    expect(decl('.lb-rank', 'color')).toBe('var(--gray-10)')
    // No highlight and no rule: either would make a shared rank read as a winner.
    expect(ruleFor('.lb-lead')).toBeNull()
    expect(rule('.lb-row')).not.toMatch(/background/)
    // Pick 4: nothing separates the standings from the band but the 3cqh gap.
    expect(rule('.b-lb')).not.toMatch(/border/)
  })
})

/**
 * The hero's own arithmetic, at every setting the knob offers and the three counts the
 * mockup draws. The claim is the one the stylesheet cannot make for itself: the rows and
 * the gaps between them fill --b-hero-n exactly, the hero and the band and their gap
 * fill the safe frame exactly, and the row's fixed tracks leave the name a field.
 */
describe('the leaderboard hero arithmetic', () => {
  const COUNTS = [2, 3, 8]

  it('fills the hero and the safe frame at every far and every count', () => {
    for (const far of FARS) {
      for (const teams of COUNTS) {
        for (const comp of ['mats', 'done'] as const) {
          const sign = comp === 'done'
          const b = boardBudget({ comp, mats: 2, teams, far, note: false, sign })
          const vars = lbVars(far, teams, comp, sign)
          const where = `${comp}, ${teams} teams at far ${far}`
          const row = px('var(--lb-row)', vars)
          const gap = px(decl('.b-lb', 'gap'), vars)

          // The stylesheet's own division of the hero, against the budget's.
          expect(row, where).toBeCloseTo(lbRowFor(b.hero, teams, far) * CQH, 6)
          expect(gap, where).toBeCloseTo(lbGapFor(teams) * far * CQH, 6)
          expect(teams * row + (teams - 1) * gap, where).toBeCloseTo(px('var(--b-lb-h)', { ...vars, '--b-lb-h': decl('.b-lb', 'height') }), 6)

          // And the frame: hero, gap, band and every closing line, inside 90cqh.
          const frame = b.hero + b.heroGap + b.band + b.footerGap + b.footer
            + b.resultGap + b.result + b.noteGap + b.note + b.signGap + b.sign
          expect(frame, where).toBeCloseTo(SAFE_CQH, 6)
          expect(row, where).toBeGreaterThan(0)
          // Nothing renders type its own box cannot hold: both steps are clamped to it.
          expect(px('var(--lb-name)', vars), where).toBeLessThanOrEqual(row + 1e-9)
          expect(px('var(--lb-wins)', vars) * 0.78, where).toBeLessThanOrEqual(row + 1e-9)
        }
      }
    }
  })

  it('leaves the team name a field at every far and every count', () => {
    // The fixed tracks are the rank, both indents, the two gaps, the wins slot and the
    // points slot. The name is the flexible one, which is 6.15's "names truncate, they
    // never shrink": at eight teams and far 1 it still has most of the safe width.
    for (const far of FARS) {
      for (const teams of COUNTS) {
        const vars = lbVars(far, teams)
        const where = `${teams} teams at far ${far}`
        const name = px('var(--lb-name)', vars)
        const wins = px('var(--lb-wins)', vars)
        const tracks = decl('.lb-row', 'grid-template-columns').replace(/minmax\(0, 1fr\)/g, 'FLEX').split(' ')
        expect(tracks.filter(t => t === 'FLEX'), where).toHaveLength(1)
        const fixed = tracks
          .filter(t => t !== 'FLEX' && t !== 'auto')
          .reduce((sum, t) => sum + px(t, vars, t === 'var(--lb-col-wins)' ? wins : name), 0)
          + px(decl('.lb-row', 'padding-left'), vars)
          + px(decl('.lb-row', 'padding-right'), vars)
          // The points track is `auto`: three characters of the name step plus " pts".
          + 3 * CH_EM * name + 4 * PTS_EM * name
        expect(fixed, where).toBeLessThan(SAFE_W)
        expect(SAFE_W - fixed, where).toBeGreaterThan(SAFE_W / 3)
      }
    }
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

  /**
   * G34 / 7.3. The row carried one gutter, it was reserved for the live cue, and only
   * position said whose side is whose, which is the one thing a parent at the door cannot
   * infer. The team edge is a 1.2cqh full height bar per competitor line, absolutely
   * positioned so the row keeps every track and every number in 6.15's arithmetic.
   */
  it('carries a team edge per competitor line that costs no track', () => {
    const vars = boardVars(1)
    expect(px('var(--b-edge-w)', vars)).toBeCloseTo(1.2 * CQH, 6)
    // The edge sits inside the indent, which scales with the knob, so the edge scales with
    // it: unscaled, it overran the mat numeral's track at 0.85 and fell short at 1.2.
    for (const far of FARS) {
      const at = boardVars(far)
      expect(px('var(--b-edge-w)', at), `far ${far}`).toBeCloseTo(1.2 * CQH * far, 6)
      expect(px(decl('.b-row', 'padding-left'), at), `far ${far}`).toBeCloseTo(2 * px('var(--b-edge-w)', at), 6)
    }
    // One token for the live gutter and the team edges, so the three cannot drift apart.
    expect(decl('.b-gut', 'width')).toBe('var(--b-edge-w)')
    expect(decl('.b-edge', 'width')).toBe('var(--b-edge-w)')
    expect(decl('.b-edge', 'position')).toBe('absolute')
    expect(decl('.b-edge', 'top')).toBe('0')
    expect(decl('.b-edge', 'bottom')).toBe('0')
    expect(decl('.b-edge', 'background')).toBe('var(--team)')

    // Section 8 keeps the leading half of the padding for --live, so team A takes the
    // second half, which the 2.4cqh indent already reserved and nothing else uses.
    expect(decl('.b-gut', 'left')).toBe('0')
    expect(decl('.b-edge-a', 'left')).toBe('var(--b-edge-w)')
    expect(decl('.b-edge-b', 'right')).toBe('0')

    // The one cost, and it is inside a track rather than beside it, so no column moves.
    expect(decl('.b-name-b', 'padding-right')).toBe('var(--b-edge-w)')
    expect(ruleFor('.b-name-a')).not.toMatch(/padding/)

    // Section 8 drops the team colour with everything else after the ten second hold.
    expect(decl('.b-row-settled .b-edge', 'background')).toBe('transparent')
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

/**
 * G27. The desk event's setup band puts one head over the whole band and the running
 * order in columns under it. The budget gives that head a b3 line and SETUP_HEAD_GAP,
 * the same spend as the per mat head, so the band itself must add nothing to it.
 */
describe('the desk running order', () => {
  it('spends the head and its gap above the columns, and nothing else', () => {
    const body = rule("[data-comp='setup'] .b-band-order")
    expect(declIn(body, 'flex-direction')).toBe('column')
    // The row gap the setup band puts between its columns is a column gap here too
    // unless it is stated away, and the budget never counted it.
    expect(declIn(body, 'gap')).toBe('0')
    expect(px(decl('.b-setup-head', 'height'), boardVars(1))).toBeCloseTo(B3 * CQH, 6)
    expect(px(decl('.b-setup-head', 'margin-bottom'), boardVars(1))).toBeCloseTo(SETUP_HEAD_GAP * CQH, 6)
    expect(decl('.b-order', 'flex')).toBe('1 1 0')
    expect(decl('.b-order', 'flex-direction')).toBe('row')
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

describe('the certified line', () => {
  it('is a line of its own, centred and quiet, never the note\'s attend colour', () => {
    const body = rule('.b-sign')
    expect(body).not.toMatch(/position\s*:/)
    expect(declIn(body, 'flex')).toBe('none')
    expect(px(declIn(body, 'height'), boardVars(1))).toBeCloseTo(B3 * CQH, 6)
    expect(px(declIn(body, 'margin-top'), boardVars(1))).toBeCloseTo(CQH, 6)
    expect(px(declIn(body, 'font-size'), boardVars(1))).toBeCloseTo(B3 * CQH, 6)
    // 6.15's approved frame: centred under the summary, not left aligned in the note row.
    expect(declIn(body, 'justify-content')).toBe('center')
    // Section 8 keeps --attend for a state that needs a person. A signature needs nobody.
    expect(declIn(body, 'color')).toBe('var(--gray-10)')
    expect(decl('.b-sign-at', 'color')).toBe('var(--gray-11)')
    expect(decl('.b-note', 'color')).toBe('var(--attend)')
  })
})

/**
 * G05 / G26 / 7.10. Two rows that used to be information-free blanks now carry a
 * sentence, and both of them are read at 30 feet like everything else on the board.
 */
describe('the two lines that replace a blank', () => {
  for (const selector of ['.b-row-note', '.b-row-empty']) {
    it(`states ${selector} at the floor step, at the read floor colour`, () => {
      const body = rule(selector)
      expect(declIn(body, 'font-size')).toBe(selector === '.b-row-note' ? 'var(--b-name-step)' : 'var(--b3)')
      expect(declIn(body, 'color')).toBe('var(--gray-10)')
      expect(declIn(body, 'line-height')).toBe('1')
    })
  }

  // The mat note lives inside the row it belongs to, so it costs the composition nothing
  // and the mat numeral beside it keeps its own track.
  it('lays the mat note across the name and score tracks and truncates', () => {
    const body = rule('.b-row-note')
    expect(declIn(body, 'grid-column')).toBe('3 / -1')
    expect(declIn(body, 'text-overflow')).toBe('ellipsis')
    expect(body).not.toMatch(/(?:^|[;{\n])\s*height\s*:/)
  })

  // The empty band line is one b3 row inside a band already sized for four result rows.
  it('spends one b3 line on the empty data entry band', () => {
    expect(px(decl('.b-row-empty', 'height'), boardVars(1))).toBeCloseTo(B3 * CQH, 6)
    expect(decl('.b-row-empty', 'flex')).toBe('none')
  })
})

/**
 * G16. The settled row stays quiet and still says who won: the winner keeps the row's
 * own --gray-11 and the loser drops exactly one step, to the --gray-10 floor.
 */
describe('the settled row still names a winner', () => {
  it('steps the loser down one, and no further than the floor', () => {
    expect(decl('.b-row-settled .b-fade', 'color')).toBe('var(--gray-10)')
    expect(decl('.b-row-settled .b-name', 'color')).toBe('var(--gray-11)')
    expect(decl('.b-row-settled .b-score', 'color')).toBe('var(--gray-11)')
    // Source order settles the tie: both selectors weigh the same, so the fade has to
    // come after the monotone rule or the loser would read as the winner.
    expect(css.indexOf('.b-row-settled .b-fade')).toBeGreaterThan(css.indexOf('.b-row-settled .b-name'))
  })

  // 7.5 keeps the figure tones on the figures. A name never takes one, so the sheet
  // carries no rule that would let it.
  it('leaves the figure tones off the name track', () => {
    expect(ruleFor('.b-name.b-lead')).toBeNull()
    expect(ruleFor('.b-name.b-trail')).toBeNull()
    expect(decl('.b-lead', 'color')).toBe('var(--fig-lead)')
    expect(decl('.b-trail', 'color')).toBe('var(--fig-trail)')
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
    // The settled row background and the letterbox bars outside the stage, which 3.4
    // states in those words. The plate the third one cut its code out of is retired.
    expect(css.match(/var\(--gray-1\)/g)).toHaveLength(2)
    expect(decl('.b-row-settled', 'background')).toBe('var(--gray-1)')
    expect(decl('.b-frame', 'background')).toBe('var(--gray-1)')
  })
})
