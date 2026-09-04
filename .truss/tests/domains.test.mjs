// .truss/tests/domains.test.mjs — U5: the generated domain register.
//
// Four contracts, in the order the feature is built from:
//   1. parseFrontmatterList (lib/md.mjs) accepts the two documented list forms
//      and nothing else.
//   2. lib/domains.mjs is the ONE definition of "domain": a context/**.md whose
//      frontmatter carries a non-empty focus:.
//   3. `truss status` prints the register from those files, and stays silent
//      (no block, no finding, exit unchanged) when there are none.
//   4. Frontmatter is invisible to `truss map` — same title, same description —
//      and CX-01 does not grow by a single token when domains are added.
//
// SY-01/SY-12 live in checks.test.mjs next to the other SY tests.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { parseFrontmatter, parseFrontmatterList } from '../lib/md.mjs'
import { readDomain, listDomains, hasDomains } from '../lib/domains.mjs'
import { generateMapContent } from '../lib/commands/map.mjs'
import { loadWorkspace } from '../lib/workspace.mjs'
import * as cx from '../checks/cx.mjs'
import { CONTEXT_FILES, phaseReadTargets, wordCount, toTokens } from '../lib/context-budget.mjs'
import { runInit } from '../lib/commands/init.mjs'
import { runStatus } from '../lib/commands/status.mjs'
import { makeRoot, runChecks } from './helpers.mjs'

const DAY = 86_400_000

/** Run a value through the REAL parseFrontmatter, so the list tests see exactly
 *  what production hands parseFrontmatterList — including the folded '\n'. */
const frontmatterValue = (block, key) =>
  parseFrontmatter(`---\n${block}\n---\nbody`.split('\n')).data[key]

const fileCtx = (content, { ageDays = 0 } = {}) => {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return { lines, content, stat: { mtimeMs: Date.now() - ageDays * DAY } }
}

const ctxOf = (files) => ({ files: new Map(Object.entries(files)) })

const captureStatus = async (root) => {
  const output = []
  const originalLog = console.log
  try {
    console.log = (...args) => output.push(args.join(' '))
    await runStatus(root, [])
  } finally { console.log = originalLog }
  return output.join('\n')
}

const DOMAIN = (focus, rest = '') =>
  `---\nfocus: ${focus}\n${rest}---\n\n# Domain\n\n> One line of scope.\n\nBody.\n`

// ── 1. parseFrontmatterList ──────────────────────────────────────────────────

describe('parseFrontmatterList (lib/md.mjs)', () => {
  it('returns [] for the empty and missing cases', () => {
    assert.deepEqual(parseFrontmatterList(undefined), [])
    assert.deepEqual(parseFrontmatterList(''), [])
    assert.deepEqual(parseFrontmatterList(frontmatterValue('next:', 'next')), [])
  })

  it('reads the comma list (one-liner form)', () => {
    assert.deepEqual(
      parseFrontmatterList(frontmatterValue('next: alpha, beta', 'next')),
      ['alpha', 'beta'])
  })

  it('reads the YAML block form, which is what parseFrontmatter folds with \\n', () => {
    const value = frontmatterValue('next:\n  - alpha\n  - beta, with a comma', 'next')
    assert.equal(value, '\n- alpha\n- beta, with a comma', 'precondition: the folded shape')
    assert.deepEqual(parseFrontmatterList(value), ['alpha', 'beta, with a comma'])
  })

  it('reads a one-element block (the shape a fresh domain starts with)', () => {
    assert.deepEqual(
      parseFrontmatterList(frontmatterValue('next:\n  - only one', 'next')),
      ['only one'])
  })

  it('does NOT support inline YAML — the documented limitation, pinned', () => {
    // docs/conventions.md tells authors to use one of the two forms above
    // precisely because this one parses wrong rather than failing loudly.
    assert.deepEqual(
      parseFrontmatterList(frontmatterValue('next: [a, b]', 'next')),
      ['[a', 'b]'])
  })
})

// ── 2. the definition of a domain ────────────────────────────────────────────

describe('lib/domains.mjs — one definition of "domain" (E5)', () => {
  it('a context file with a non-empty focus: IS a domain', () => {
    const d = readDomain(fileCtx(DOMAIN('pricing model')), 'context/pricing.md')
    assert.ok(d)
    assert.equal(d.name, 'pricing')
    assert.equal(d.focus, 'pricing model')
    assert.deepEqual(d.next, [])
  })

  it('a context file WITHOUT frontmatter is skipped — silently, not a finding', () => {
    assert.equal(readDomain(fileCtx('# Notes\n\n> Scope.\n\nBody.\n'), 'context/notes.md'), null)
  })

  it('frontmatter with next: but no focus: is not a domain (E5 is literally focus:)', () => {
    const content = '---\nnext:\n  - a\n---\n\n# X\n'
    assert.equal(readDomain(fileCtx(content), 'context/x.md'), null)
  })

  it('an empty or placeholder focus: is not a domain', () => {
    assert.equal(readDomain(fileCtx('---\nfocus:\n---\n\n# X\n'), 'context/x.md'), null)
    assert.equal(readDomain(fileCtx('---\nfocus: —\n---\n\n# X\n'), 'context/x.md'), null)
    assert.equal(readDomain(fileCtx('---\nfocus: none\n---\n\n# X\n'), 'context/x.md'), null)
  })

  it('the same frontmatter outside context/ is not a domain', () => {
    assert.equal(readDomain(fileCtx(DOMAIN('x')), 'state/current.md'), null)
    assert.equal(readDomain(fileCtx(DOMAIN('x')), 'notes.md'), null)
  })

  it('counts open points from either list form, and drops placeholders', () => {
    const block = readDomain(
      fileCtx(DOMAIN('a', 'next:\n  - one\n  - two\nblockers: none\n')), 'context/a.md')
    assert.deepEqual(block.next, ['one', 'two'])
    assert.deepEqual(block.blockers, [])

    const inline = readDomain(
      fileCtx(DOMAIN('a', 'next: one, two\n')), 'context/a.md')
    assert.deepEqual(inline.next, ['one', 'two'])
  })

  it('dot names are a naming convention only — nothing splits on the dot', () => {
    const d = readDomain(fileCtx(DOMAIN('incorporation')), 'context/legal.incorporation.md')
    assert.equal(d.name, 'legal.incorporation')
    // A nested directory keeps working; the name simply carries the path.
    const nested = readDomain(fileCtx(DOMAIN('x')), 'context/legal/trademark.md')
    assert.equal(nested.name, 'legal/trademark')
  })

  it('listDomains / hasDomains agree with readDomain over a whole workspace', () => {
    const ctx = ctxOf({
      'context/b.md': fileCtx(DOMAIN('b focus')),
      'context/a.md': fileCtx(DOMAIN('a focus')),
      'context/plain.md': fileCtx('# Plain\n'),
      'state/current.md': fileCtx(DOMAIN('not a domain')),
    })
    assert.equal(hasDomains(ctx), true)
    assert.deepEqual(listDomains(ctx).map(d => d.name), ['a', 'b'])
    assert.equal(hasDomains(ctxOf({ 'context/plain.md': fileCtx('# Plain\n') })), false)
    assert.equal(hasDomains(ctxOf({})), false)
  })
})

// ── 3. the register in `truss status` ────────────────────────────────────────

describe('truss status — Domains register (U5)', () => {
  it('a fresh workspace has no context/ at all: no block, no finding, exit 0', async () => {
    const root = await makeRoot('truss-domains-none-')
    try {
      await runInit(root, ['--name', 'Empty', '--lang', 'English'])
      const before = process.exitCode
      const out = await captureStatus(root)
      assert.doesNotMatch(out, /Domains:/)
      assert.equal(process.exitCode, before, 'status must not change the exit code')
      const findings = await runChecks(root)
      assert.equal(findings.filter(f => f.id === 'SY-12').length, 0)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('lists a domain with its focus, its open count and its age', async () => {
    const root = await makeRoot('truss-domains-list-')
    try {
      await runInit(root, ['--name', 'Reg', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'context'), { recursive: true })
      await fs.writeFile(path.join(root, 'context', 'pricing.md'),
        DOMAIN('settle the per-seat price', 'next:\n  - ask three customers\n  - draft the page\n'))
      const old = Date.now() - 4 * DAY
      await fs.utimes(path.join(root, 'context', 'pricing.md'), old / 1000, old / 1000)

      const out = await captureStatus(root)
      assert.match(out, /Domains: pricing — settle the per-seat price {2}\(2 open, 4d\)/)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('a domain with focus: but no next: is listed with 0 open points', async () => {
    const root = await makeRoot('truss-domains-zero-')
    try {
      await runInit(root, ['--name', 'Reg', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'context'), { recursive: true })
      await fs.writeFile(path.join(root, 'context', 'legal.md'), DOMAIN('incorporation paperwork'))
      assert.match(await captureStatus(root), /Domains: legal — incorporation paperwork {2}\(0 open/)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('a context file without frontmatter is skipped — not listed, not flagged', async () => {
    const root = await makeRoot('truss-domains-skip-')
    try {
      await runInit(root, ['--name', 'Reg', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'context'), { recursive: true })
      await fs.writeFile(path.join(root, 'context', 'notes.md'), '# Notes\n\n> Scope.\n\nBody.\n')
      assert.doesNotMatch(await captureStatus(root), /Domains:/)
      assert.equal((await runChecks(root)).filter(f => f.id === 'SY-12').length, 0)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('caps the list and counts the rest, like the Open block does', async () => {
    const root = await makeRoot('truss-domains-overflow-')
    try {
      await runInit(root, ['--name', 'Reg', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'context'), { recursive: true })
      for (let i = 0; i < 11; i++) {
        await fs.writeFile(path.join(root, 'context', `d${i}.md`), DOMAIN(`focus ${i}`))
      }
      const out = await captureStatus(root)
      assert.match(out, /… and 3 more in context\//)
      assert.equal(out.split('\n').filter(l => / — focus \d+ {2}\(0 open/.test(l)).length, 8)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})

// ── 4. frontmatter is invisible to the map, and free in the boot budget ──────

describe('frontmatter does not disturb the map or the boot budget', () => {
  it('title and description are identical with and without frontmatter', async () => {
    const body = '# Pricing\n\n> What we charge and why.\n\nBody text.\n'
    const withFm = `---\nfocus: settle the price\nnext:\n  - ask customers\n---\n${body}`

    const rootA = await makeRoot('truss-domains-map-a-')
    const rootB = await makeRoot('truss-domains-map-b-')
    try {
      for (const [root, content] of [[rootA, body], [rootB, withFm]]) {
        await runInit(root, ['--name', 'M', '--lang', 'English'])
        await fs.mkdir(path.join(root, 'context'), { recursive: true })
        await fs.writeFile(path.join(root, 'context', 'pricing.md'), content)
      }
      const row = (content) => content.split('\n').find(l => l.includes('`context/pricing.md`'))
      const rowA = row(await generateMapContent(rootA))
      const rowB = row(await generateMapContent(rootB))
      assert.ok(rowA, 'precondition: the map has a row for the domain file')
      // Only the ~Tokens cell may differ (frontmatter is words on disk).
      const withoutTokens = (r) => r.split('|').slice(0, 4).join('|')
      assert.equal(withoutTokens(rowB), withoutTokens(rowA))
      assert.match(rowA, /\| Pricing \| What we charge and why\. \|/)
    } finally {
      await fs.rm(rootA, { recursive: true, force: true })
      await fs.rm(rootB, { recursive: true, force: true })
    }
  })

  it('a YAML comment in the frontmatter does not become the map title', async () => {
    const root = await makeRoot('truss-domains-map-comment-')
    try {
      await runInit(root, ['--name', 'M', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'context'), { recursive: true })
      await fs.writeFile(path.join(root, 'context', 'pricing.md'),
        '---\n# TODO: split this file\nfocus: settle the price\n---\n\n# Pricing\n\n> What we charge.\n\nBody.\n')
      const row = (await generateMapContent(root)).split('\n')
        .find(l => l.includes('`context/pricing.md`'))
      assert.match(row, /\| Pricing \| What we charge\. \|/)
      assert.doesNotMatch(row, /TODO/)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('a leading horizontal rule (--- with no frontmatter) is left alone', async () => {
    const root = await makeRoot('truss-domains-map-hr-')
    try {
      await runInit(root, ['--name', 'M', '--lang', 'English'])
      await fs.mkdir(path.join(root, 'context'), { recursive: true })
      await fs.writeFile(path.join(root, 'context', 'ruled.md'),
        '---\n\n# Ruled\n\n> Still has its description.\n\nBody.\n')
      const row = (await generateMapContent(root)).split('\n')
        .find(l => l.includes('`context/ruled.md`'))
      assert.match(row, /\| Ruled \| Still has its description\. \|/)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('ten domains add exactly 0 tokens to the CX-01 boot measurement', async () => {
    // CX-01 is silent below the warn band, so the assertion is made against the
    // number itself, computed from the same single source the check reads
    // (lib/context-budget.mjs) rather than by parsing a message that may not
    // even be printed.
    const bootTokens = async (root) => {
      const ctx = await loadWorkspace(root)
      const seen = new Set()
      let words = 0
      for (const rel of [...CONTEXT_FILES, ...phaseReadTargets(ctx.phases)]) {
        if (seen.has(rel)) continue
        seen.add(rel)
        const f = ctx.files.get(rel)
        if (f) { words += wordCount(f.content); continue }
        try { words += wordCount(await fs.readFile(path.join(root, rel), 'utf8')) } catch { /* absent */ }
      }
      return toTokens(words)
    }

    const root = await makeRoot('truss-domains-budget-')
    try {
      await runInit(root, ['--name', 'B', '--lang', 'English'])
      const before = await bootTokens(root)
      assert.ok(before > 0, 'precondition: the fresh workspace has boot context')

      await fs.mkdir(path.join(root, 'context'), { recursive: true })
      const filler = Array(400).fill('word').join(' ')
      for (let i = 0; i < 10; i++) {
        await fs.writeFile(path.join(root, 'context', `d${i}.md`),
          DOMAIN(`focus ${i}`, 'next:\n  - one\n  - two\n') + filler + '\n')
      }
      assert.equal(await bootTokens(root), before,
        'context/** is not boot context — the budget must not move')
      // And CX-01 itself stays exactly as quiet (or as loud) as it was.
      assert.equal((await cx.run(await loadWorkspace(root))).length, 0)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})
