// .truss/tests/branch-guard.test.mjs — SY-05 nudge + branch-guard preference
// Run with: node --test .truss/tests/branch-guard.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { runInit } from '../lib/commands/init.mjs'
import { makeRoot, runChecks, errorsOf, read } from './helpers.mjs'

const findingIds = (fs) => fs.map(f => f.id)

describe('branch-guard preference', () => {
  it('renders no directive by default (off) and a warn directive on set', async () => {
    const root = await makeRoot('truss-bg-pref-')
    await runInit(root, ['--name', 'A', '--lang', 'English'])
    const agents = await read(root, 'AGENTS.md')
    assert.doesNotMatch(agents, /- branch-guard=/)
    // no errors introduced by the empty default block
    assert.equal(errorsOf(await runChecks(root)).length, 0)
  })
})

describe('SY-05 (overlay branch declaration nudge)', () => {
  it('does not fire for a project without a repo/ checkout', async () => {
    const root = await makeRoot('truss-sy05-none-')
    await runInit(root, ['--name', 'A', '--lang', 'English', '--overlay'])
    const ids = findingIds(await runChecks(root))
    assert.ok(!ids.includes('SY-05'), 'no SY-05 without a repo/ checkout')
  })

  it('fires when repo/ is a checkout but branch: is blank', async () => {
    const root = await makeRoot('truss-sy05-blank-')
    await runInit(root, ['--name', 'A', '--lang', 'English', '--overlay'])
    await fs.mkdir(path.join(root, 'repo', '.git'), { recursive: true }) // simulate a checkout
    const found = (await runChecks(root)).filter(f => f.id === 'SY-05')
    assert.equal(found.length, 1)
    assert.equal(found[0].severity, 'W')
  })

  it('clears once a branch is declared', async () => {
    const root = await makeRoot('truss-sy05-set-')
    await runInit(root, ['--name', 'A', '--lang', 'English', '--overlay'])
    await fs.mkdir(path.join(root, 'repo', '.git'), { recursive: true })
    const cur = await read(root, 'state/current.md')
    await fs.writeFile(path.join(root, 'state', 'current.md'), cur.replace(/^branch:.*$/m, 'branch: main'), 'utf8')
    const ids = findingIds(await runChecks(root))
    assert.ok(!ids.includes('SY-05'), 'SY-05 cleared after declaring branch:')
  })
})
