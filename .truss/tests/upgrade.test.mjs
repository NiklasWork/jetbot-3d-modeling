// .truss/tests/upgrade.test.mjs — `truss upgrade` (D-034)
// Run with: node --test .truss/tests/upgrade.test.mjs
//
// Two fixture styles, on purpose:
//   - a hand-built baseline, so every branch of the decision matrix can be hit
//     with all three sides (mine/base/theirs) under exact control;
//   - a REAL one, scaffolded by `init` from the shipped baseline, because the
//     hand-built fixture can only prove what it happens to contain. The first
//     cut of these tests asserted "never touches project state" against a
//     fixture whose baseline had no state/ files at all — the assertion passed
//     and the claim was false. `realFixture` is what guards that claim now.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { runUpgrade, parseUpgradeArgs, planBaseline, alignGeneratedBlocks, isSeedOnly, UpgradeError } from '../lib/commands/upgrade.mjs'
import { runInit } from '../lib/commands/init.mjs'
import { writeManifest } from '../lib/engine-manifest.mjs'
import { makeRoot, ENGINE_DIR } from './helpers.mjs'

process.env.TRUSS_NO_GIT = '1'   // never consult the workspace's own git state

const write = async (root, rel, content) => {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
}
const read = (root, rel) => fs.readFile(path.join(root, rel), 'utf8')
const exists = async (root, rel) => { try { await fs.access(path.join(root, rel)); return true } catch { return false } }
const planOf = (r) => Object.fromEntries(r.plan.map(p => [p.rel, p.action]))

const FIVE = 'one\ntwo\nthree\nfour\nfive\n'

/** A workspace on 0.0.1 plus a 0.0.2 engine, covering the whole decision matrix. */
async function fixture() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-upgrade-'))
  const ws = path.join(tmp, 'ws')
  const next = path.join(tmp, 'next')

  await write(ws, '.truss/VERSION', '0.0.1\n')
  await write(next, '.truss/VERSION', '0.0.2\n')
  await write(next, '.truss/lib/marker.mjs', 'export const NEW = true\n')  // proof the engine really swapped
  await write(ws, '.truss/prompts/custom/mine.md', 'my own prompt\n')

  const b = (rel, c) => write(ws, path.join('.truss/baseline', rel), c)
  const t = (rel, c) => write(next, path.join('.truss/baseline', rel), c)
  const m = (rel, c) => write(ws, rel, c)

  // untouched upstream → never considered
  await b('docs/stable.md', 'same\n');      await t('docs/stable.md', 'same\n');       await m('docs/stable.md', 'locally rewritten\n')
  // unmodified locally → clean take
  await b('docs/take.md', 'old\n');         await t('docs/take.md', 'new\n');          await m('docs/take.md', 'old\n')
  // both changed, different lines → clean 3-way merge
  await b('docs/merge.md', FIVE);           await t('docs/merge.md', FIVE.replace('five', 'FIVE'));
  await m('docs/merge.md', FIVE.replace('one', 'ONE'))
  // both changed, same line → conflict
  await b('docs/clash.md', FIVE);           await t('docs/clash.md', FIVE.replace('one', 'THEIRS'))
  await m('docs/clash.md', FIVE.replace('one', 'MINE'))
  // new in this version
  await t('docs/fresh.md', 'brand new\n')
  // dropped from the baseline → kept as the project's
  await b('docs/dropped.md', 'was baseline\n'); await m('docs/dropped.md', 'was baseline\n')
  // deleted locally → not resurrected
  await b('docs/gone.md', 'old\n');         await t('docs/gone.md', 'new\n')
  // binary changed on both sides → never fed to a line merge
  await b('docs/logo.bin', Buffer.from([0, 1, 2]));  await t('docs/logo.bin', Buffer.from([0, 9, 9]))
  await m('docs/logo.bin', Buffer.from([0, 7, 7]))
  // a merge that would come out conflict-free but structurally invalid
  await b('package.json', '{\n  "a": 1,\n  "b": 2\n}\n')
  await t('package.json', '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n')
  await m('package.json', '{\n  "a": 1,\n  "b": 2\n}  \n')

  // SEED files — project matter, never written even though the baseline moved
  await b('state/current.md', 'focus: [template]\n');  await t('state/current.md', 'focus: [new template]\n')
  await m('state/current.md', 'focus: real project work\n')
  await b('state/decisions.md', '# Decisions\n');       await t('state/decisions.md', '# Decisions\n\n> new header line\n')
  await m('state/decisions.md', '# Decisions\n')        // identical to base: the copyFile trap
  await b('VISION.md', '# [name]\n');                   await t('VISION.md', '# [name]\n\nNew section.\n')
  await m('VISION.md', '# Real Vision\n')
  // an init input, not a workspace file
  await t('overlay/phases.md', 'current: ingest\n')

  const agents = (blockBody, tail) =>
    `# AGENTS.md\n\n<!-- truss:begin preferences -->\n${blockBody}\n<!-- truss:end preferences -->\n\n${tail}\n`
  await b('AGENTS.md', agents('- placeholder', 'Rule: old wording.'))
  await t('AGENTS.md', agents('- placeholder', 'Rule: new wording.'))
  await m('AGENTS.md', agents('- clarify=ask :: real rendered pref', 'Rule: old wording.'))

  return { tmp, ws, next }
}

/**
 * A workspace scaffolded by `init` from the SHIPPED baseline, plus a next engine
 * whose baseline differs in one seed file and one framework file.
 */
async function realFixture() {
  const ws = await makeRoot('truss-upgrade-real-')
  await runInit(ws, ['--name', 'Real Project', '--lang', 'English'])
  await fs.writeFile(path.join(ws, '.truss/VERSION'), '0.0.1\n')

  const next = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-upgrade-next-'))
  await fs.cp(path.join(ENGINE_DIR, 'baseline'), path.join(next, '.truss/baseline'), { recursive: true })
  await fs.writeFile(path.join(next, '.truss/VERSION'), '0.0.2\n')

  const bump = async (rel, extra) => {
    const abs = path.join(next, '.truss/baseline', rel)
    await fs.writeFile(abs, `${await fs.readFile(abs, 'utf8')}${extra}`)
  }
  await bump('state/current.md', '\n<!-- new template hint -->\n')
  await bump('state/profile.md', '\nnew-field: [value]\n')
  await bump('docs/git.md', '\nA new framework rule.\n')

  return { ws, next }
}

describe('parseUpgradeArgs', () => {
  it('parses flags in both forms', () => {
    assert.deepEqual(parseUpgradeArgs([]), { root: null, force: false, dryRun: false })
    assert.deepEqual(parseUpgradeArgs(['--root', '/p/ws', '--force']), { root: '/p/ws', force: true, dryRun: false })
    assert.equal(parseUpgradeArgs(['--root=/p/ws']).root, '/p/ws')
    assert.equal(parseUpgradeArgs(['-n']).dryRun, true)
    assert.throws(() => parseUpgradeArgs(['--root']), UpgradeError)
    assert.throws(() => parseUpgradeArgs(['--nope']), UpgradeError)
  })
})

describe('isSeedOnly', () => {
  it('covers project matter and nothing else', () => {
    for (const rel of ['state/current.md', 'state/decisions.md', 'VISION.md', 'README.md']) {
      assert.equal(isSeedOnly(rel), true, rel)
    }
    for (const rel of ['AGENTS.md', 'docs/git.md', 'package.json', '.gitignore', 'CLAUDE.md']) {
      assert.equal(isSeedOnly(rel), false, rel)
    }
  })
})

describe('alignGeneratedBlocks', () => {
  it('lifts the workspace block body into the other side, leaving prose alone', () => {
    const mine   = '# T\n<!-- truss:begin phase -->\nrendered\n<!-- truss:end phase -->\nmine tail\n'
    const theirs = '# T\n<!-- truss:begin phase -->\nplaceholder\n<!-- truss:end phase -->\ntheirs tail\n'
    const out = alignGeneratedBlocks(mine, theirs)
    assert.match(out, /rendered/)
    assert.doesNotMatch(out, /placeholder/)
    assert.match(out, /theirs tail/)
  })
  it('works on CRLF input (the Windows default)', () => {
    const crlf = (s) => s.replace(/\n/g, '\r\n')
    const out = alignGeneratedBlocks(
      crlf('# T\n<!-- truss:begin phase -->\nrendered\n<!-- truss:end phase -->\n'),
      crlf('# T\n<!-- truss:begin phase -->\nplaceholder\n<!-- truss:end phase -->\n'),
    )
    assert.match(out, /rendered/)
    assert.doesNotMatch(out, /placeholder/)
  })
  it('leaves malformed marker regions strictly alone instead of corrupting them', () => {
    const mine = '# T\n<!-- truss:begin phase -->\nRENDERED\n<!-- truss:end phase -->\n'
    // an orphan end before the real pair — a negative splice range if trusted
    const other = 'a\n<!-- truss:end phase -->\nb\n<!-- truss:begin phase -->\nplaceholder\n<!-- truss:end phase -->\nz\n'
    assert.equal(alignGeneratedBlocks(mine, other), other)
  })
  it('is a no-op when there are no blocks', () => {
    assert.equal(alignGeneratedBlocks('plain\n', 'other\n'), 'other\n')
  })
})

describe('planBaseline', () => {
  it('classifies every case of the decision matrix', async () => {
    const { tmp, ws, next } = await fixture()
    const plan = await planBaseline(ws, path.join(ws, '.truss/baseline'), path.join(next, '.truss/baseline'))
    const by = Object.fromEntries(plan.map(p => [p.rel, p.action]))

    assert.equal(by['docs/stable.md'], undefined, 'upstream unchanged is not planned at all')
    assert.equal(by['docs/take.md'], 'write')
    assert.equal(by['docs/merge.md'], 'merge')
    assert.equal(by['docs/clash.md'], 'merge')
    assert.equal(by['docs/fresh.md'], 'write')
    assert.equal(by['docs/dropped.md'], 'skip')
    assert.equal(by['docs/gone.md'], 'skip')
    assert.equal(by['docs/logo.bin'], 'report', 'binaries never reach a line merge')
    assert.equal(by['AGENTS.md'], 'merge')
    assert.equal(by['state/current.md'], 'report', 'seed file is reported, never written')
    assert.equal(by['state/decisions.md'], 'report', 'seed file identical to base is still not overwritten')
    assert.equal(by['VISION.md'], 'report')
    assert.equal(by['overlay/phases.md'], undefined, 'init inputs are not workspace files')
    await fs.rm(tmp, { recursive: true, force: true })
  })
})

describe('runUpgrade', () => {
  it('does not add newly introduced assets from opted-out skill groups', async () => {
    const ws = await makeRoot('truss-upgrade-skills-')
    await runInit(ws, ['--name', 'Opt out', '--lang', 'English', '--skills', 'none'])
    await fs.writeFile(path.join(ws, '.truss/VERSION'), '0.0.1\n')

    const next = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-upgrade-skills-next-'))
    await fs.cp(path.join(ENGINE_DIR, 'baseline'), path.join(next, '.truss/baseline'), { recursive: true })
    await fs.writeFile(path.join(next, '.truss/VERSION'), '0.0.2\n')
    await write(
      next,
      '.truss/baseline/.claude/skills/marketing-new/SKILL.md',
      '# Newly introduced marketing skill\n',
    )

    const result = await runUpgrade(next, ['--root', ws])
    assert.equal(await exists(ws, '.claude/skills/marketing-new/SKILL.md'), false)
    assert.equal(
      result.plan.some(entry => entry.rel === '.claude/skills/marketing-new/SKILL.md'),
      false,
    )
  })

  // D-069's safety rests on a coupling, not on the line above: `init` MUST write
  // `.claude/.truss-skills.json`, because readSelectedGroups() reads a MISSING
  // file as "every group" and an upgrade then installs all 83 skills into a
  // workspace that asked for none. The opt-out test alone cannot see that — it
  // would still pass if the ENOENT branch started returning an empty set, at
  // which point the invariant it rests on would quietly stop mattering. This is
  // the other side of the coupling, and it is the side that bites (`L-011`).
  it('treats a MISSING skill selection as every group — the invariant `init` must uphold', async () => {
    const ws = await makeRoot('truss-upgrade-skills-missing-')
    await runInit(ws, ['--name', 'No selection', '--lang', 'English', '--skills', 'none'])
    await fs.writeFile(path.join(ws, '.truss/VERSION'), '0.0.1\n')

    // Exactly the state a default `init` would leave behind if it ever stopped
    // writing the selection file.
    await fs.rm(path.join(ws, '.claude/.truss-skills.json'))

    const next = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-upgrade-skills-missing-next-'))
    await fs.cp(path.join(ENGINE_DIR, 'baseline'), path.join(next, '.truss/baseline'), { recursive: true })
    await fs.writeFile(path.join(next, '.truss/VERSION'), '0.0.2\n')
    await write(
      next,
      '.truss/baseline/.claude/skills/marketing-new/SKILL.md',
      '# Newly introduced marketing skill\n',
    )

    await runUpgrade(next, ['--root', ws])
    assert.equal(
      await exists(ws, '.claude/skills/marketing-new/SKILL.md'),
      true,
      'without a selection file the upgrade installs the group — which is why init must always write one',
    )
  })

  it('swaps the engine, reconciles the baseline, and never writes project state', async () => {
    const { tmp, ws, next } = await fixture()
    const before = {
      current: await read(ws, 'state/current.md'),
      decisions: await read(ws, 'state/decisions.md'),
      vision: await read(ws, 'VISION.md'),
      stable: await read(ws, 'docs/stable.md'),
    }

    const r = await runUpgrade(next, ['--root', ws])
    process.exitCode = 0     // the run flags "needs attention"; don't fail the test process
    assert.equal(r.from, '0.0.1')
    assert.equal(r.to, '0.0.2')

    // engine
    assert.equal((await read(ws, '.truss/VERSION')).trim(), '0.0.2')
    assert.ok(await exists(ws, '.truss/lib/marker.mjs'), 'new engine files are in place')
    assert.equal(await read(ws, '.truss/prompts/custom/mine.md'), 'my own prompt\n')
    assert.ok(await exists(ws, '.truss.bak-0.0.1/baseline/AGENTS.md'), 'old baseline survives as the merge base')
    assert.equal(await exists(ws, '.truss.incoming'), false, 'staging directory is gone')

    // project matter — byte-identical, whatever the baseline did
    assert.equal(await read(ws, 'state/current.md'), before.current)
    assert.equal(await read(ws, 'state/decisions.md'), before.decisions)
    assert.equal(await read(ws, 'VISION.md'), before.vision)
    assert.equal(await read(ws, 'docs/stable.md'), before.stable)
    assert.equal(await read(ws, 'docs/dropped.md'), 'was baseline\n')
    assert.equal(await exists(ws, 'docs/gone.md'), false)
    assert.equal(await exists(ws, 'state/current.md.truss-merge'), false, 'seed files get no side file either')

    // applied
    assert.equal(await read(ws, 'docs/take.md'), 'new\n')
    assert.equal(await read(ws, 'docs/fresh.md'), 'brand new\n')
    const merged = await read(ws, 'docs/merge.md')
    assert.match(merged, /ONE/, 'local change survives')
    assert.match(merged, /FIVE/, 'upstream change lands')
    assert.doesNotMatch(merged, /<<<</)

    // conflict + invalid-JSON merge: side file written, original left bootable
    assert.equal(await read(ws, 'docs/clash.md'), FIVE.replace('one', 'MINE'))
    assert.match(await read(ws, 'docs/clash.md.truss-merge'), /<<<</)
    assert.equal(planOf(r)['package.json'], 'conflict', 'a clean-but-invalid merge is not written')
    JSON.parse(await read(ws, 'package.json'))

    // binary untouched
    assert.deepEqual([...await fs.readFile(path.join(ws, 'docs/logo.bin'))], [0, 7, 7])

    // AGENTS.md: prose updated, rendered block body preserved, no conflict
    const agents = await read(ws, 'AGENTS.md')
    assert.match(agents, /Rule: new wording\./)
    assert.match(agents, /clarify=ask :: real rendered pref/)
    assert.doesNotMatch(agents, /placeholder/)
    assert.doesNotMatch(agents, /<<<</)
    assert.equal(await exists(ws, 'AGENTS.md.truss-merge'), false)

    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('leaves the real shipped state files alone while applying real framework changes', async () => {
    const { ws, next } = await realFixture()
    // A legacy single-file log (D-087 no longer ships one as a seed). Written
    // here on purpose: this is the adopter who upgrades the engine WITHOUT
    // migrating, and their decision log must come through untouched.
    await fs.writeFile(path.join(ws, 'state/decisions.md'),
      '# Decisions\n\n## D-001 — Recorded before the upgrade\nDate: 2026-01-01\n'
      + 'Decision: This must survive byte-identically.\nRationale: r.\nConsequences: c.\n')
    const before = {
      current: await read(ws, 'state/current.md'),
      profile: await read(ws, 'state/profile.md'),
      vision: await read(ws, 'VISION.md'),
      decisions: await read(ws, 'state/decisions.md'),
      phases: await read(ws, 'state/phases.md'),
    }

    const r = await runUpgrade(next, ['--root', ws])
    process.exitCode = 0
    const by = planOf(r)

    for (const [rel, was] of Object.entries(before)) {
      const relPath = rel === 'vision' ? 'VISION.md' : `state/${rel === 'current' ? 'current' : rel}.md`
      assert.equal(await read(ws, relPath), was, `${relPath} must be byte-identical`)
    }
    assert.equal(by['state/current.md'], 'report')
    assert.equal(by['state/profile.md'], 'report')
    assert.equal(by['docs/git.md'], 'written', 'framework files still upgrade')
    assert.match(await read(ws, 'docs/git.md'), /A new framework rule\./)

    await fs.rm(ws, { recursive: true, force: true })
    await fs.rm(next, { recursive: true, force: true })
  })

  it('does not follow a symlink out of the workspace', async () => {
    const { tmp, ws, next } = await fixture()
    const outside = path.join(tmp, 'outside.md')
    await fs.writeFile(outside, 'old\n')
    await fs.rm(path.join(ws, 'docs/take.md'))
    await fs.symlink(outside, path.join(ws, 'docs/take.md'))

    await runUpgrade(next, ['--root', ws])
    process.exitCode = 0
    assert.equal(await fs.readFile(outside, 'utf8'), 'old\n', 'the file outside the workspace is untouched')
    assert.equal(await read(ws, 'docs/take.md'), 'new\n')
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('does not follow a symlinked directory out of the workspace', async () => {
    const { tmp, ws, next } = await fixture()
    const outside = path.join(tmp, 'outside-docs')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'take.md'), 'old\n')
    await fs.rm(path.join(ws, 'docs'), { recursive: true })
    await fs.symlink(outside, path.join(ws, 'docs'))

    const r = await runUpgrade(next, ['--root', ws])
    process.exitCode = 0
    assert.equal(await fs.readFile(path.join(outside, 'take.md'), 'utf8'), 'old\n',
      'a file outside the workspace must never be written')
    assert.equal(planOf(r)['docs/take.md'], 'failed')
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('clears a staging directory an interrupted run left behind', async () => {
    const { tmp, ws, next } = await fixture()
    await write(ws, '.truss.incoming/VERSION', '0.0.2\n')
    await write(ws, '.truss.incoming/half-copied.mjs', 'junk\n')

    const r = await runUpgrade(next, ['--root', ws])
    process.exitCode = 0
    assert.equal(r.to, '0.0.2', 'the retry runs through instead of tripping over its own scratch')
    assert.equal(await exists(ws, '.truss.incoming'), false)
    assert.equal(await exists(ws, '.truss/half-copied.mjs'), false, 'stale staging never becomes the new engine')
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('--dry-run reports without writing', async () => {
    const { tmp, ws, next } = await fixture()
    const r = await runUpgrade(next, ['--root', ws, '--dry-run'])
    assert.equal(r.dryRun, true)
    assert.ok(r.plan.length > 0)
    assert.equal((await read(ws, '.truss/VERSION')).trim(), '0.0.1')
    assert.equal(await read(ws, 'docs/take.md'), 'old\n')
    assert.equal(await exists(ws, '.truss.bak-0.0.1'), false)
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('refuses to destroy a backup an earlier run left behind', async () => {
    const { tmp, ws, next } = await fixture()
    await write(ws, '.truss.bak-0.0.1/KEEP.txt', 'unfinished upgrade\n')
    await assert.rejects(() => runUpgrade(next, ['--root', ws]), UpgradeError)
    assert.equal(await read(ws, '.truss.bak-0.0.1/KEEP.txt'), 'unfinished upgrade\n')
    assert.equal((await read(ws, '.truss/VERSION')).trim(), '0.0.1', 'nothing was changed')
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('signals unfinished work through the exit code', async () => {
    const { tmp, ws, next } = await fixture()
    process.exitCode = 0
    await runUpgrade(next, ['--root', ws])
    assert.equal(process.exitCode, 3, 'conflicts must not look like a clean run to a script')
    process.exitCode = 0
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('is a no-op at the same version, and refuses obvious misuse', async () => {
    const { tmp, ws, next } = await fixture()
    await fs.writeFile(path.join(ws, '.truss/VERSION'), '0.0.2\n')
    const r = await runUpgrade(next, ['--root', ws])
    assert.equal(r.upToDate, true)
    assert.equal(await exists(ws, '.truss.bak-0.0.2'), false)

    await assert.rejects(() => runUpgrade(next, ['--root', next]), UpgradeError)   // engine onto itself
    await assert.rejects(() => runUpgrade(next, ['--root', tmp]), UpgradeError)    // not a workspace
    await fs.rm(tmp, { recursive: true, force: true })
  })
})

// ── Migration path for D-035: open-decisions.md returns to the baseline ──────
// An instance that upgrades from a version without the file must NOT have it
// written for it: everything under state/ is the project's own (SEED_ONLY,
// D-034), and that guarantee outranks the convenience of one file. upgrade
// reports it; ST-01 then names it with a one-step fix.
describe('a baseline state file the workspace lacks', () => {
  it('is reported, never written — the SEED_ONLY guarantee holds', async () => {
    const { ws, next } = await realFixture()

    // Simulate the pre-D-035 instance: the file the new baseline ships is absent.
    await fs.rm(path.join(ws, 'state/open-decisions.md'))
    await fs.rm(path.join(ws, '.truss/baseline/state/open-decisions.md'))

    const res = await runUpgrade(next, ['--root', ws, '--dry-run'])
    process.exitCode = 0
    const entry = res.plan.find(p => p.rel === 'state/open-decisions.md')

    assert.ok(entry, 'the missing baseline file must appear in the plan')
    assert.equal(entry.action, 'report')
    assert.match(entry.note, /seed file/)
    assert.equal(await exists(ws, 'state/open-decisions.md'), false)
  })

  it('stays hands-off on a real run too, not just in a dry run', async () => {
    const { ws, next } = await realFixture()
    await fs.rm(path.join(ws, 'state/open-decisions.md'))
    await fs.rm(path.join(ws, '.truss/baseline/state/open-decisions.md'))

    await runUpgrade(next, ['--root', ws])
    process.exitCode = 0
    assert.equal(await exists(ws, 'state/open-decisions.md'), false)
  })

  it('leaves an existing one untouched, however far it has drifted', async () => {
    const { ws, next } = await realFixture()
    const mine = '# Open Decisions\n\n## OD-001 — mine\n\nOpened: 2026-01-01\n'
    await fs.writeFile(path.join(ws, 'state/open-decisions.md'), mine)

    await runUpgrade(next, ['--root', ws])
    process.exitCode = 0
    assert.equal(await read(ws, 'state/open-decisions.md'), mine)
  })
})

// ── D-070: engine divergence is read before the swap and carried into the report ──
// Measured problem this decision fixes: `upgrade --force` reverted lib/+checks/
// without a trace and told the adopter "the engine swap was the whole upgrade".
// These tests prove the OLD engine's local edits are captured before renaming
// it aside — reading AFTER the swap would see the NEW engine's own files instead.
describe('D-070: engine manifest divergence in the upgrade report', () => {
  it('--dry-run names a locally modified engine file without touching anything', async () => {
    const { ws, next } = await realFixture()
    await writeManifest(path.join(ws, '.truss'))   // the manifest this workspace's engine shipped with
    const patched = path.join(ws, '.truss/lib/workspace.mjs')
    await fs.writeFile(patched, `${await fs.readFile(patched, 'utf8')}\n// locally patched for this test\n`)

    const res = await runUpgrade(next, ['--root', ws, '--dry-run'])
    process.exitCode = 0

    assert.ok(res.engineDivergence, 'a manifest was present — divergence must be reported, not null')
    assert.deepEqual(res.engineDivergence.modified, ['lib/workspace.mjs'])
    assert.equal(res.engineDivergence.missing.length, 0)
    assert.equal(res.engineDivergence.extra.length, 0)
    // --dry-run never renames .truss/ aside — the file the test patched is still there, untouched.
    assert.match(await fs.readFile(patched, 'utf8'), /locally patched for this test/)
  })

  it('a real run still reports the OLD engine\'s divergence, even though .truss/ now holds the NEW engine', async () => {
    const { ws, next } = await realFixture()
    await writeManifest(path.join(ws, '.truss'))
    const patched = path.join(ws, '.truss/lib/workspace.mjs')
    await fs.writeFile(patched, `${await fs.readFile(patched, 'utf8')}\n// locally patched for this test\n`)

    const r = await runUpgrade(next, ['--root', ws])
    process.exitCode = 0

    assert.deepEqual(r.engineDivergence.modified, ['lib/workspace.mjs'])
    // Proof the read really happened before the swap: the engine really did
    // swap (VERSION moved on) and the backup — the renamed-aside OLD engine —
    // still carries the patch the report above already knew about.
    assert.equal((await fs.readFile(path.join(ws, '.truss/VERSION'), 'utf8')).trim(), '0.0.2')
    assert.match(await fs.readFile(path.join(r.backup, 'lib/workspace.mjs'), 'utf8'), /locally patched for this test/)
  })

  it('reports "no manifest" rather than silence when the old engine shipped without one', async () => {
    const { ws, next } = await realFixture()   // realFixture never writes a manifest
    const res = await runUpgrade(next, ['--root', ws, '--dry-run'])
    process.exitCode = 0
    assert.equal(res.engineDivergence, null)
  })

  it('reports clean divergence when the engine matches its manifest untouched', async () => {
    const { ws, next } = await realFixture()
    await writeManifest(path.join(ws, '.truss'))
    const res = await runUpgrade(next, ['--root', ws, '--dry-run'])
    process.exitCode = 0
    assert.deepEqual(res.engineDivergence, { modified: [], missing: [], extra: [], unreadable: [] })
  })

  // An unreadable engine file used to escape verifyEngine as a raw EACCES and
  // abort the whole command — with none of the "nothing was changed" wording
  // every other failure path in upgrade.mjs guarantees. D-070 is reporting
  // only; it must never be able to stop an upgrade. chmod 000 does not bind
  // root, so this is meaningless in a root container — and on Windows,
  // fs.chmod never blocks reads at all, so it's meaningless there too.
  it('an unreadable engine file is reported, and never aborts the run',
    { skip: process.getuid?.() === 0 || process.platform === 'win32' }, async () => {
      const { ws, next } = await realFixture()
      await writeManifest(path.join(ws, '.truss'))
      const victim = path.join(ws, '.truss/lib/workspace.mjs')
      await fs.chmod(victim, 0o000)
      let res
      try {
        res = await runUpgrade(next, ['--root', ws, '--dry-run'])
      } finally {
        await fs.chmod(victim, 0o644)
      }
      process.exitCode = 0
      assert.deepEqual(res.engineDivergence.unreadable, ['lib/workspace.mjs'])
      assert.deepEqual(res.engineDivergence.modified, [],
        'a file that could not be read is not known to have changed')
      assert.deepEqual(res.engineDivergence.missing, [])
    })
})
