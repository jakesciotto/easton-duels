import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

/**
 * B1. Tailwind v4 preflight sets `button { cursor: default }`, and jsdom applies no
 * stylesheet, so the only honest check for the pointer rule is against the declarations
 * themselves. Same approach as board-css.test.ts and shell-css.test.ts.
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

function ruleFor(body: string, selector: string): string {
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

const base = atRule('@layer base')

describe('B1 pointer cursor', () => {
  it('gives every enabled interactive role a pointer', () => {
    for (const selector of [
      'button',
      "a[href]",
      "[role='button']",
      "[role='menuitem']",
      "[role='option']",
      "[role='tab']",
      "[role='radio']",
      "[role='checkbox']",
      "[role='switch']",
      'label[for]',
      'summary',
    ]) {
      expect(declIn(ruleFor(base, selector), 'cursor'), selector).toBe('pointer')
    }
  })

  it('drops back to the default arrow when disabled', () => {
    expect(declIn(ruleFor(base, ':disabled'), 'cursor')).toBe('default')
    expect(declIn(ruleFor(base, "[aria-disabled='true']"), 'cursor')).toBe('default')
  })

  it('leaves text inputs and textareas at the platform cursor', () => {
    expect(base).not.toMatch(/(?:^|[;{\n])\s*input\b[^{]*\{[^}]*cursor\s*:\s*pointer/)
    expect(base).not.toMatch(/(?:^|[;{\n])\s*textarea\b[^{]*\{[^}]*cursor\s*:\s*pointer/)
  })
})
