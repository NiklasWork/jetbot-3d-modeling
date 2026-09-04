// .truss/tests/split-decisions.test.mjs — the one-time migration (D-087).
//
// The property that matters is not "it wrote files" but "it changed nothing it
// was not asked to change": same entries, same index, same doctor verdict. A
// migration that silently drops or reorders an entry is worse than no migration
// at all, because the loss is invisible afterwards.
//
// Run with: node --test .truss/tests/split-decisions.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runSplitDecisions } from '../lib/commands/split-decisions.mjs'
import {
  buildIndex, renderIndex, readDecisionSource, parseDecisionEntries, parseDecisionSource,
  INDEX_REL, SOURCE_REL, DECISIONS_DIR, decisionPath,
} from '../lib/decisions-index.mjs'
import { runInit } from '../lib/commands/init.mjs'
import { makeRoot, runChecks, errorsOf } from './helpers.mjs'

const ids = (findings, id) => findings.filter(f => f.id === id)

// This file lives at <repo>/.truss/tests/split-decisions.test.mjs → ENGINE_DIR = <repo>/.truss
// fileURLToPath, never `new URL(...).pathname`: on Windows the latter yields
// '/D:/a/…', which path.join turns into a drive-relative 'D:\D:\a\…' — the file
// then does not exist and the test fails for a reason that has nothing to do
// with what it asserts. Same derivation as tests/helpers.mjs.
const ENGINE_DIR = path.join(fileURLToPath(import.meta.url), '..', '..')

const PREAMBLE = `# Decisions

> Decided decisions. D-NNN, sequential, never reused. Never delete — supersede instead.
> D-001 – D-002 archived → archive/decisions-d001-d002.md (pre-beta; still valid).
`

const LOG = PREAMBLE + `
## D-003 — Files are the single source of truth
Date: 2026-01-03
Decision: Every operational fact lives in exactly one file.
Rationale: Two copies drift, silently.
Consequences: doctor grows a check per rule.

## D-004 — The engine ships as a directory
Date: 2026-01-04
Decision: \`.truss/\` is the distribution.
Rationale: Zero install surface.
Consequences: \`truss upgrade\` replaces the directory.
Superseded-by: D-005

> Superseded by D-005 (2026-01-05): packaging moved.

## D-005 — Decisions bind until superseded
Date: 2026-01-05
Decision: An entry binds until a later D-NNN supersedes it.
Rationale: Otherwise every session re-litigates the log.
Consequences: \`Superseded-by:\` is the only way out.
`

async function workspaceWith(log, prefix) {
  const root = await makeRoot(prefix)
  await runInit(root, ['--name', 'Split', '--lang', 'English'])
  await fs.writeFile(path.join(root, SOURCE_REL), log)
  return root
}

describe('split-decisions — the split itself', () => {
  it('writes one file per entry and leaves the index byte-identical', async () => {
    const root = await workspaceWith(LOG, 'truss-split-happy-')
    // Entry lines only: the header sentence names the layout, so it changes on
    // purpose. What must not change is which entries the index carries.
    const entryLines = (idx) => idx.split('\n').filter(l => l.startsWith('- **'))
    const before = entryLines(buildIndex(LOG.split('\n')))

    const res = await runSplitDecisions(root)
    assert.equal(res.entries, 3)

    for (const id of ['D-003', 'D-004', 'D-005']) {
      const body = await fs.readFile(path.join(root, decisionPath(id)), 'utf8')
      assert.match(body, new RegExp(`^## ${id} — `), `${id}.md starts with its own heading`)
      // Exactly one entry per file — a body that swallowed its neighbour would
      // still index correctly but would be unopenable by ID.
      assert.equal(parseDecisionEntries(body.split('\n')).length, 1)
    }

    const after = await readDecisionSource(root)
    assert.equal(after.form, 'dir')
    assert.deepEqual(entryLines(renderIndex(parseDecisionSource(after), 'dir')), before,
      'the split must not lose, reorder or alter an entry')
    assert.deepEqual(entryLines(await fs.readFile(path.join(root, INDEX_REL), 'utf8')), before)
    // …and the header must now describe the layout the workspace actually has.
    assert.match(await fs.readFile(path.join(root, INDEX_REL), 'utf8'),
      /body of `D-NNN` is `state\/decisions\/D-NNN\.md`/)
  })

  it('carries a supersede note with the entry it belongs to', async () => {
    // The note sits between two entries in the flat file; it must land with the
    // entry above it, not with the one below.
    const root = await workspaceWith(LOG, 'truss-split-note-')
    await runSplitDecisions(root)

    const d004 = await fs.readFile(path.join(root, decisionPath('D-004')), 'utf8')
    assert.match(d004, /Superseded by D-005 \(2026-01-05\)/)
    const d005 = await fs.readFile(path.join(root, decisionPath('D-005')), 'utf8')
    assert.doesNotMatch(d005, /Superseded by D-005/)
  })

  it('keeps the preamble — archive pointers are real content', async () => {
    const root = await workspaceWith(LOG, 'truss-split-preamble-')
    const res = await runSplitDecisions(root)
    assert.equal(res.preamble, true)

    const left = await fs.readFile(path.join(root, SOURCE_REL), 'utf8')
    assert.match(left, /archive\/decisions-d001-d002\.md/,
      'the pointer to an already-archived range must survive the split')
    assert.doesNotMatch(left, /^## D-\d{3}/m, 'no entry may be left behind')
  })

  it('leaves the workspace exactly as healthy as it found it', async () => {
    // The adopter promise (D-081): migrating must not introduce a single finding.
    const root = await workspaceWith(LOG, 'truss-split-doctor-')
    const { runMap } = await import('../lib/commands/map.mjs')
    const { writeIndex } = await import('../lib/decisions-index.mjs')
    await writeIndex(root); await runMap(root, [])
    const before = await runChecks(root)

    await runSplitDecisions(root)
    await runMap(root, [])
    const after = await runChecks(root)

    assert.equal(errorsOf(after).length, 0, 'no errors introduced')
    // The fixture's preamble cites an archived range this test workspace does
    // not carry, so RF-02 has entries before AND after — comparing the whole
    // finding set below is the real proof. What must hold absolutely is that no
    // SPLIT entry became unresolvable.
    for (const id of ['D-003', 'D-004', 'D-005']) {
      assert.equal(ids(after, 'RF-02').filter(f => f.message.includes(id)).length, 0,
        `${id} must still resolve after its body moved`)
    }
    assert.deepEqual(ids(after, 'RF-03').map(f => f.message), [],
      'no id may end up defined twice')
    assert.deepEqual(ids(after, 'ST-10'), [], 'the index matches its new source')
    // Compared by id AND message: an id-only comparison would call a finding
    // that moved from state/decisions.md:12 to state/decisions/D-004.md:6
    // "unchanged", which is exactly the kind of drift this is meant to catch.
    const shape = (fs_) => fs_.map(f => `${f.id} ${f.message}`).sort()
    assert.deepEqual(shape(after), shape(before),
      'the finding set is unchanged — the split is not an excuse for new noise')
  })

  it('keeps the bodies out of the map but inside the checks', async () => {
    const root = await workspaceWith(LOG, 'truss-split-map-')
    await runSplitDecisions(root)
    const { runMap, generateMapContent } = await import('../lib/commands/map.mjs')
    await runMap(root, [])

    const map = await generateMapContent(root)
    assert.doesNotMatch(map, /state\/decisions\/D-\d{3}\.md/,
      '40 decision rows would bury the domain files the map exists to show')

    // …but the loader still sees them, or every reference would be an RF-02.
    const findings = await runChecks(root)
    for (const id of ['D-003', 'D-004', 'D-005']) {
      assert.equal(ids(findings, 'RF-02').filter(f => f.message.includes(id)).length, 0,
        `${id} is defined in ${DECISIONS_DIR}/ and must be visible to RF`)
    }
  })
})

describe('split-decisions — what the review found', () => {
  it('refuses a malformed id rather than swallow it into the entry above', async () => {
    // `## D-99` is not an entry to the parser, so it would silently become part
    // of the previous body — a second decision hidden inside another one.
    const root = await workspaceWith(LOG + '\n## D-99 — zu kurz\nDate: 2026-01-07\nDecision: x\n', 'truss-split-malformed-')
    await assert.rejects(() => runSplitDecisions(root), /malformed id/)
    await assert.rejects(() => fs.readdir(path.join(root, DECISIONS_DIR)), 'nothing written')
  })

  it('keeps the file\'s own line endings', async () => {
    const root = await workspaceWith(LOG.replace(/\n/g, '\r\n'), 'truss-split-crlf-')
    await runSplitDecisions(root)
    const body = await fs.readFile(path.join(root, decisionPath('D-003')), 'utf8')
    assert.ok(body.includes('\r\n'), 'CRLF input must not come back as LF')
    assert.doesNotMatch(body, /[^\r]\n/, 'and must not come back mixed')
  })

  it('says which body to check when content follows a horizontal rule', async () => {
    // Everything after the last entry travels with it; a horizontal rule is the
    // one reliable sign that it was file-level content, not part of the entry.
    const root = await workspaceWith(LOG + '\n---\n> D-001 – D-002 archived → archive/decisions-d001-d002.md\n', 'truss-split-tail-')
    const res = await runSplitDecisions(root)
    assert.equal(res.tail, true, 'the run must flag it rather than move it silently')
  })
})

describe('split-decisions — refusals', () => {
  const rejects = async (root, re) =>
    assert.rejects(() => runSplitDecisions(root), (e) => (assert.match(e.message, re), true))

  it('refuses when there is nothing to split', async () => {
    const root = await makeRoot('truss-split-none-')
    await runInit(root, ['--name', 'Split', '--lang', 'English'])
    await fs.rm(path.join(root, SOURCE_REL), { force: true })
    await rejects(root, /nothing to split/)
  })

  it('refuses when the workspace is already split', async () => {
    const root = await workspaceWith(LOG, 'truss-split-twice-')
    await runSplitDecisions(root)
    await rejects(root, /already split/)
  })

  it('refuses on a duplicate id rather than let one body overwrite another', async () => {
    const dupe = LOG + '\n## D-004 — A second entry with the same id\nDate: 2026-01-06\nDecision: x\n'
    const root = await workspaceWith(dupe, 'truss-split-dupe-')
    await rejects(root, /duplicate id.*D-004/s)

    // Nothing was written: the refusal comes before any file is touched.
    await assert.rejects(() => fs.readdir(path.join(root, DECISIONS_DIR)))
  })

  it('refuses a log with no entries at all', async () => {
    const root = await workspaceWith(PREAMBLE, 'truss-split-empty-')
    await rejects(root, /no '## D-NNN' entries/)
  })
})

describe('split-decisions — dispatch and documentation', () => {
  it('is dispatchable and documented in lockstep', async () => {
    // Same guard as `ack`: a migration nobody can find is a migration nobody
    // runs, and `truss help` alone does not explain what it costs or protects.
    const { COMMAND_META } = await import('../lib/command-meta.mjs')
    assert.ok(COMMAND_META.find(c => c.name === 'split-decisions'), 'missing from COMMAND_META')
    const cli = await fs.readFile(path.join(ENGINE_DIR, 'docs', 'cli.md'), 'utf8')
    assert.match(cli, /^## `split-decisions`$/m)
  })

  it('is named by the upgrade report, the one place an adopter is looking', async () => {
    // `upgrade` never writes state/, so this migration cannot be applied there.
    // If the report does not name it, the change is invisible to every adopter.
    const src = await fs.readFile(path.join(ENGINE_DIR, 'lib', 'commands', 'upgrade.mjs'), 'utf8')
    assert.match(src, /split-decisions/)
  })
})

describe('split-decisions — --dry-run', () => {
  it('reports what it would do and writes nothing', async () => {
    const root = await workspaceWith(LOG, 'truss-split-dry-')
    const before = await fs.readFile(path.join(root, SOURCE_REL), 'utf8')

    const res = await runSplitDecisions(root, ['--dry-run'])
    assert.equal(res.dryRun, true)
    assert.equal(res.entries, 3)

    assert.equal(await fs.readFile(path.join(root, SOURCE_REL), 'utf8'), before)
    await assert.rejects(() => fs.readdir(path.join(root, DECISIONS_DIR)),
      'a dry run must not even create the directory')
  })
})
