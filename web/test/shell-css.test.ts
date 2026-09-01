import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

/**
 * 6.18's two shell rules live where a type checker cannot see them and a component test
 * cannot either: jsdom applies no stylesheet and computes no layout, so the only honest
 * check is against the declarations themselves. Same approach as board-css.test.ts.
 */
function cssPath(): string {
  for (const candidate of ['src/index.css', 'web/src/index.css']) {
    const full = resolvePath(process.cwd(), candidate)
    if (existsSync(full)) return full
  }
  throw new Error(`index.css not found from ${process.cwd()}`)
}

const css = readFileSync(cssPath(), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The balanced body of the first at-rule whose prelude contains `header`. */
function atRule(header: string): string {
  const start = css.indexOf(header)
  if (start === -1) throw new Error(`index.css has no ${header}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`index.css never closes ${header}`)
}

function ruleIn(body: string, selector: string): string {
  for (const match of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].split(',').map(s => s.trim()).includes(selector)) return match[2]
  }
  throw new Error(`no rule for ${selector}`)
}

function declIn(body: string, prop: string): string {
  const found = new RegExp(`(?:^|[;{\\n])\\s*${prop}\\s*:\\s*([^;]+);`).exec(body)
  if (!found) throw new Error(`no ${prop} in rule`)
  return found[1].replace(/\s+/g, ' ').trim()
}

// The ramp, read back out of the stylesheet: step number to the px it declares.
const ramp = new Map<string, { size: number; step: number }>()
for (const match of css.matchAll(/\.(t[1-9])\s*\{([^}]*)\}/g)) {
  const body = match[2]
  ramp.set(match[1], {
    size: Number(/font-size:\s*([0-9.]+)px/.exec(body)?.[1]),
    step: Number(/--step:\s*([0-9.]+)px/.exec(body)?.[1]),
  })
}

describe('6.18 coarse pointer floor', () => {
  it('floors every form control at 16px on a coarse pointer', () => {
    const body = atRule('@media (pointer: coarse)')
    const selector = 'input, textarea, select, [contenteditable]'
    const rule = new RegExp(`(^|})\\s*${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{`).test(body)
    expect(rule).toBe(true)
    expect(declIn(body, 'font-size')).toBe('max(16px, var(--step, 1em))')
  })

  it('raises the three steps below the floor and caps none of the ones above it', () => {
    const floor = (step: number) => Math.max(16, step)
    expect(ramp.size).toBe(9)
    // t1, t2 and t3 are the three steps iOS zooms for. Everything from t4 up is already
    // at or over the floor, so a scorer's 44px figure keeps its own size.
    expect(floor(ramp.get('t1')!.step)).toBe(16)
    expect(floor(ramp.get('t2')!.step)).toBe(16)
    expect(floor(ramp.get('t3')!.step)).toBe(16)
    for (const name of ['t4', 't5', 't6', 't7', 't8', 't9']) {
      expect(floor(ramp.get(name)!.step)).toBe(ramp.get(name)!.size)
    }
  })

  it('keeps every --step equal to the size it stands in for', () => {
    // The floor measures --step, so a step that disagrees with its own font-size would
    // silently raise or spare the wrong controls.
    for (const [name, { size, step }] of ramp) expect([name, step]).toEqual([name, size])
  })

  it('never disables user scaling to reach the floor', () => {
    expect(css).not.toMatch(/user-scalable/)
    expect(css).not.toMatch(/maximum-scale/)
  })
})

describe('6.18 tab rail', () => {
  it('scrolls the rail itself below 640px rather than the page', () => {
    const body = atRule('@media (max-width: 639px)')
    const rail = ruleIn(body, '.rail')
    expect(declIn(rail, 'overflow-x')).toBe('auto')
    expect(declIn(rail, 'overscroll-behavior-x')).toBe('contain')
  })

  it('masks 24px at the overflowing edge', () => {
    const rail = ruleIn(atRule('@media (max-width: 639px)'), '.rail')
    expect(declIn(rail, 'mask-image')).toBe('linear-gradient(to right, black calc(100% - 24px), transparent)')
  })

  it('leaves the rail alone at 640px and above, where the row fits', () => {
    // A scroll container above the breakpoint would only clip the trigger's focus ring.
    const outside = css.replace(atRule('@media (max-width: 639px)'), '')
    expect(outside).not.toMatch(/\.rail\s*\{/)
  })
})
