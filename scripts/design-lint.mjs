#!/usr/bin/env node
// Enforces the rules in .claude/plans/duels-live-design.md section 5.1 that a type
// checker cannot see. A failure names the file and the line, so it reads like a lint
// error rather than an opaque failed step.
//
// The board rules cover CSS as well as TSX, because the board keeps its colour and
// size decisions in a stylesheet and a rule that cannot see that file is a rule that
// passes while the board drifts.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const WEB_SRC = join(ROOT, 'web/src')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(tsx?|css)$/.test(full)) out.push(full)
  }
  return out
}

const isBoard = file => file.includes('/routes/board/') || file.endsWith('routes/BoardPage.tsx')

// 2.5 and 6.15 name the only three places the board may use a token below --gray-10:
// the letterbox that frames a non 16:9 panel, the settled row's recessed ground, and
// the code cut out of a team fill.
const GRAY_1_ALLOWED = /\.(b-frame|b-row-settled|b-code)\b/

const RULES = [
  {
    name: 'no hex literal in the app',
    why: 'Every colour comes from a token, so a change lands everywhere at once.',
    // index.css is where the tokens are DEFINED, so hex is its whole job. The QR code
    // paints a white tile because a scanner needs the quiet zone, which is a physical
    // requirement rather than a design decision.
    skip: file => file.endsWith('web/src/index.css') || file.endsWith('components/QrCode.tsx'),
    pattern: /#[0-9a-fA-F]{3,8}\b/,
  },
  {
    name: 'no cqh outside the board',
    why: 'Container query units are the board dialect. The console is sized in pixels.',
    skip: isBoard,
    pattern: /[0-9]cqh/,
  },
  {
    name: 'no console type scale or fixed size on the board',
    why: 'The board is sized in cqh so it scales to any panel. A px, vw or vh size does not.',
    skip: file => !isBoard(file),
    pattern: /\b(text-(xs|sm|base|lg|xl|[2-9]xl)|font-(bold|extrabold|black))\b|font-size:\s*[0-9.]+(px|vw|vh)|(text|w|h)-\[[0-9.]+(px|vw|vh)\]/,
  },
  {
    name: 'no grey below --gray-10 as board text, and no console surface token',
    why: 'At 25 feet a hairline is 1.18:1 and a card fill reads as a smudge. 6.15 deletes both.',
    skip: file => !isBoard(file),
    pattern: /var\(--gray-[2-9]\)|\b(text|bg|border)-gray-[1-9]\b|\bborder-border\b|\bbg-card\b/,
  },
  {
    name: 'no route pins its own poll interval',
    why: 'Every route under the event body reads one shared stream, which polls on the derived ramp. A pinned interval is ignored by the stream and then used as a staleness threshold, so the screen calls data fresh after the board has stopped trusting it. The board and the scorer sit outside that provider and own their own poll, so the rule does not reach them.',
    skip: file => !file.includes('/routes/event/') && !file.endsWith('routes/EventPage.tsx'),
    pattern: /useSnapshot\([^)]*,[^)]*\)/,
  },
  {
    name: 'no --gray-1 on the board outside the three places 6.15 names',
    why: 'The letterbox, the settled row and the plate code. Anywhere else it is a card fill.',
    skip: file => !isBoard(file),
    pattern: /var\(--gray-1\)/,
    // A declaration carries no selector, so the check reads the block it sits in.
    allow: (_line, selector) => GRAY_1_ALLOWED.test(selector),
  },
]

const files = walk(WEB_SRC)
let failed = 0

for (const rule of RULES) {
  const hits = []
  for (const file of files) {
    if (rule.skip(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    let selector = ''
    lines.forEach((line, i) => {
      if (line.includes('{')) selector = line.slice(0, line.indexOf('{')).trim()
      if (!rule.pattern.test(line)) return
      if (rule.allow && rule.allow(line, selector)) return
      hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
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
