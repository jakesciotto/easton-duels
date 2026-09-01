#!/usr/bin/env node
// Enforces the rules in .claude/plans/duels-live-design.md section 5.1 that a type
// checker cannot see. A failure names the file and the line, so it reads like a lint
// error rather than an opaque failed step.
//
// Two further rules from 5.1 govern the board, and they land with the board migration:
// no console type scale or px/vw/vh size inside routes/board, and no surface or line
// token inside routes/board. Adding them before that screen migrates would only report
// code we already plan to delete.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const WEB_SRC = join(ROOT, 'web/src')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const RULES = [
  {
    name: 'no hex literal in the app',
    why: 'Every colour comes from a token, so a change lands everywhere at once.',
    // The QR code paints a white tile because a scanner needs the quiet zone, and
    // that white is a physical requirement rather than a design token.
    skip: file => file.endsWith('components/QrCode.tsx'),
    pattern: /#[0-9a-fA-F]{3,8}\b/,
  },
  {
    name: 'no cqh outside the board',
    why: 'Container query units are the board dialect. The console is sized in pixels.',
    skip: file => file.includes('/routes/board/') || file.endsWith('routes/BoardPage.tsx'),
    pattern: /[0-9]cqh/,
  },
]

const files = walk(WEB_SRC)
let failed = 0

for (const rule of RULES) {
  const hits = []
  for (const file of files) {
    if (rule.skip(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (rule.pattern.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
    })
  }
  if (hits.length) {
    failed += hits.length
    console.error(`\ndesign-lint: ${rule.name} (${hits.length})`)
    console.error(`  ${rule.why}`)
    for (const hit of hits) console.error(`  ${hit}`)
  }
}

if (failed) {
  console.error(`\ndesign-lint failed with ${failed} violation${failed === 1 ? '' : 's'}.`)
  process.exit(1)
}
console.log(`design-lint passed: ${RULES.length} rules over ${files.length} files.`)
