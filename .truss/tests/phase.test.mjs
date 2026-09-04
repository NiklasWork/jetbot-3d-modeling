// .truss/tests/phase.test.mjs — `truss phase` tests
// Run with: node --test .truss/tests/phase.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { runInit } from '../lib/commands/init.mjs'
import { runPhase, PhaseError, setCurrentInFrontmatter } from '../lib/commands/phase.mjs'
import { parsePhases, parseBlocks } from '../lib/md.mjs'
import { renderNoPhasesBlock } from '../lib/render.mjs'
import { writeBlock } from '../lib/writer.mjs'
import { makeRoot, runChecks, errorsOf, exists, read } from './helpers.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'

async function phaseBlockOf(root) {
  const blocks = parseBlocks((await read(root, 'AGENTS.md')).split('\n'))
  return (blocks.get('phase')?.innerLines ?? []).join('\n')
}

describe('setCurrentInFrontmatter', () => {
  it('replaces the current: line in frontmatter only', () => {
    const raw = '---\ncurrent: ingest\n---\n\n## ingest\nlabel: Ingest\ncurrent: not-this\n'
    const out = setCurrentInFrontmatter(raw, 'operate')
    assert.match(out, /^---\ncurrent: operate\n---/)
    assert.match(out, /\ncurrent: not-this\n/) // body line untouched
  })
  it('throws when there is no frontmatter / no current line', () => {
    assert.throws(() => setCurrentInFrontmatter('## ingest\n', 'operate'), PhaseError)
    assert.throws(() => setCurrentInFrontmatter('---\nfoo: bar\n---\n', 'operate'), PhaseError)
  })
})

describe('runPhase', () => {
  it('lists phases without changing state when given no id', async () => {
    const root = await makeRoot('truss-phase-list-')
    await runInit(root, ['--name', 'L', '--lang', 'English', '--overlay'])
    const res = await runPhase(root, [])
    assert.equal(res.listed, true)
    assert.equal(res.current, 'ingest')
    assert.deepEqual(res.ordered, ['ingest', 'operate'])
    // unchanged
    const phases = parsePhases((await read(root, 'state/phases.md')).split('\n'))
    assert.equal(phases.frontmatter.current, 'ingest')
  })

  it('requires an explicit gate override, then re-renders atomically', async () => {
    const root = await makeRoot('truss-phase-set-')
    await runInit(root, ['--name', 'L', '--lang', 'English', '--overlay'])
    await assert.rejects(runPhase(root, ['operate']), /exit gate/)
    const res = await runPhase(root, ['operate', '--override-gate'])
    assert.equal(res.changed, true)
    assert.equal(res.from, 'ingest')
    assert.equal(res.current, 'operate')

    const phases = parsePhases((await read(root, 'state/phases.md')).split('\n'))
    assert.equal(phases.frontmatter.current, 'operate')
    assert.match(await phaseBlockOf(root), /\*\*Phase 2\/2 — operate/)
    assert.equal(errorsOf(await runChecks(root)).length, 0)
    assert.equal(res.gateOverridden, true)
  })

  it('throws on an unknown phase id', async () => {
    const root = await makeRoot('truss-phase-bad-')
    await runInit(root, ['--name', 'L', '--lang', 'English', '--overlay'])
    await assert.rejects(runPhase(root, ['nope']), PhaseError)
  })

  it('is a no-op when already on the target phase', async () => {
    const root = await makeRoot('truss-phase-noop-')
    await runInit(root, ['--name', 'L', '--lang', 'English', '--overlay'])
    const res = await runPhase(root, ['ingest'])
    assert.equal(res.changed, false)
  })
})

// ── U4: a workspace may legitimately have no phase model ─────────────────────

describe('no state/phases.md — absent is not broken (U4)', () => {
  /** Init a normal workspace, then delete the phase file. */
  async function withoutPhases(tag) {
    const root = await makeRoot(tag)
    await runInit(root, ['--name', 'NP', '--lang', 'English'])
    await fs.rm(path.join(root, 'state', 'phases.md'))
    return root
  }

  it('runPhase reports and exits clean instead of throwing', async () => {
    const root = await withoutPhases('truss-phase-absent-')
    const res = await runPhase(root, [])
    assert.equal(res.noPhases, true)
    // It converges the block on the same text render writes — the three
    // consumers of the notice must never disagree (that would be a BL-02 E).
    assert.equal(await phaseBlockOf(root), renderNoPhasesBlock().join('\n'))
  })

  it('an explicit target is reported, not treated as an unknown phase', async () => {
    const root = await withoutPhases('truss-phase-absent-target-')
    const res = await runPhase(root, ['operate'])
    assert.equal(res.noPhases, true)
  })

  it('deleting the file silences ST-01/PH-02; only the stale block is reported', async () => {
    const root = await withoutPhases('truss-phase-absent-doctor-')
    const findings = await runChecks(root)
    const ids = findings.map(f => f.id)
    assert.equal(ids.filter(id => id === 'ST-01').length, 0, 'ST-01 must no longer fire for a path that may be absent')
    assert.equal(ids.filter(id => id.startsWith('PH-')).length, 0, 'the phase checks must be silent, not merely downgraded')
    // The one thing that IS wrong: AGENTS.md still advertises a phase model.
    assert.deepEqual(findings.filter(f => f.severity === 'E').map(f => f.id), ['BL-02'])
  })

  it('is completely silent once the block matches (render/BL-02 agree)', async () => {
    const root = await withoutPhases('truss-phase-absent-clean-')
    await writeBlock(path.join(root, 'AGENTS.md'), 'phase', renderNoPhasesBlock())
    assert.deepEqual((await runChecks(root)).filter(f => f.id === 'BL-02'), [])
  })

  // chmod 000 does not restrict root, and on Windows fs.chmod only maps the
  // read-only/write attribute — it never blocks reads — so this simulated
  // unreadability is meaningless (and would fail) on either.
  it('a present but unreadable phases.md stays an error — absent is not broken',
    { skip: process.getuid?.() === 0 || process.platform === 'win32' }, async () => {
    const root = await makeRoot('truss-phase-unreadable-')
    await runInit(root, ['--name', 'NP', '--lang', 'English'])
    const phasesPath = path.join(root, 'state', 'phases.md')
    await fs.chmod(phasesPath, 0o000)
    try {
      const findings = await runChecks(root)
      assert(findings.some(f => f.id === 'PH-01' && /could not be read/.test(f.message)),
        `an unreadable phases.md must not be mistaken for an absent one; got ${JSON.stringify(findings.map(f => f.id))}`)
      await assert.rejects(runPhase(root, []), /could not be read/)
      assert.equal(await exists(root, 'state/phases.md'), true)
    } finally {
      await fs.chmod(phasesPath, 0o644)
    }
  })
})
