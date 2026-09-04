// .truss/tests/map-tokens.test.mjs — V-02 read-cost estimates in the map.
// Three contracts:
//   1. generateMapContent renders a 4th "~Tokens" column with coarse estimates
//      (same words × 1.5 method as the boot budget, lib/context-budget.mjs).
//   2. formatTokens rounds coarsely and stays k-formatted at the 1000 boundary.
//   3. mapComparisonKey (used by ST-07) ignores token drift but NOT structural
//      drift — editing a file's body must not flag the map as outdated, while
//      changing its description still must.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { makeRoot } from './helpers.mjs'
import { runInit } from '../lib/commands/init.mjs'
import { generateMapContent, formatTokens, mapComparisonKey } from '../lib/commands/map.mjs'

describe('formatTokens', () => {
  it('rounds coarsely below 1000 and k-formats above', () => {
    assert.equal(formatTokens(0), '~10')
    assert.equal(formatTokens(7), '~10')
    assert.equal(formatTokens(342), '~340')
    assert.equal(formatTokens(996), '~1k')      // 1000 boundary → k format
    assert.equal(formatTokens(1234), '~1.2k')
    assert.equal(formatTokens(9950), '~10k')
    assert.equal(formatTokens(15400), '~15k')
  })
})

describe('map ~Tokens column', () => {
  it('renders estimates per file and — for synthetic rows', async () => {
    const root = await makeRoot('truss-maptok-')
    await runInit(root, ['--name', 'MT', '--lang', 'English'])
    // 306 words total (incl. heading/quote markers) → 459 tokens → ~460.
    const body = Array(300).fill('word').join(' ')
    await fs.writeFile(path.join(root, 'domain.md'), `# Domain\n\n> A test domain.\n\n${body}\n`)

    const content = await generateMapContent(root)
    assert.match(content, /\| File \| Title \| Description \| ~Tokens \|/)
    assert.match(content, /\| `domain\.md` \| Domain \| A test domain\. \| ~460 \|/)
    // The self-referential map.md row carries no estimate.
    assert.match(content, /\| `state\/map\.md` \| Truss Map \|.*\| — \|/)
    await fs.rm(root, { recursive: true, force: true })
  })
})

describe('mapComparisonKey (ST-07 stability)', () => {
  it('ignores token drift but catches structural drift', async () => {
    const root = await makeRoot('truss-maptok-key-')
    await runInit(root, ['--name', 'MT', '--lang', 'English'])
    const domain = path.join(root, 'domain.md')
    await fs.writeFile(domain, `# Domain\n\n> A test domain.\n\nshort body\n`)
    const before = await generateMapContent(root)

    // Body grows → word count changes, title/description stay put.
    await fs.writeFile(domain, `# Domain\n\n> A test domain.\n\n${Array(500).fill('word').join(' ')}\n`)
    const afterBodyEdit = await generateMapContent(root)
    assert.notEqual(afterBodyEdit, before, 'raw content must reflect the new estimate')
    assert.equal(mapComparisonKey(afterBodyEdit), mapComparisonKey(before), 'token drift alone must not change the comparison key')

    // Description changes → structural drift → key must differ.
    await fs.writeFile(domain, `# Domain\n\n> A different description.\n\nshort body\n`)
    const afterDescEdit = await generateMapContent(root)
    assert.notEqual(mapComparisonKey(afterDescEdit), mapComparisonKey(before), 'description drift must still fire')
    await fs.rm(root, { recursive: true, force: true })
  })
})
