// .truss/tests/decisions-index.test.mjs — the decision index (D-075, D-087) and ST-10.
//
// Two load-bearing properties live here.
//
//   1. "The index defines nothing." It carries every D-NNN a second time, so its
//      FORM is the only thing standing between it and one RF-03 error per
//      decision. A refactor to `## D-NNN — …` headings must turn this file red
//      instead of quietly turning a healthy workspace into a 40-error one.
//   2. "Both forms work." D-087 moved the bodies to state/decisions/<ID>.md, but
//      a workspace that never split still has state/decisions.md and must keep
//      working and produce no finding (D-077). Every ST-10 case is therefore
//      run against both layouts.
//
// Run with: node --test .truss/tests/decisions-index.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  buildIndex, parseDecisionEntries, writeIndex, readDecisionSource,
  INDEX_REL, SOURCE_REL, DECISIONS_DIR, decisionPath,
} from '../lib/decisions-index.mjs'
import { parseIdDefinitions, parseIdReferences } from '../lib/md.mjs'
import { loadSchema } from '../lib/schema.mjs'
import { runInit } from '../lib/commands/init.mjs'
import { makeRoot, runChecks, errorsOf, read } from './helpers.mjs'

// The shipped ID classes — since D-079 the ID parsers take them as an argument.
const IDS = (await loadSchema(path.join(path.sep, 'truss-no-such-workspace'))).ids

const ids = (findings, id) => findings.filter(f => f.id === id)

/** A decisions.md with the shapes that actually occur in a real log. */
const SOURCE = `# Decisions

> Decided decisions. D-NNN, sequential, never reused.

## D-001 — Files are the single source of truth
Date: 2026-01-01
Decision: Every operational fact lives in exactly one file; scripts only report.
Rationale: Two copies drift, and the drift is silent.
Consequences: doctor grows a check per rule, never a second store.

## D-002 — The engine ships as a directory, not a package

Date: 2026-01-02
Decision: \`.truss/\` is the distribution; nothing is published to npm.
Rationale: Zero install surface.
Consequences: \`truss upgrade\` replaces the directory.
Rejected: npm — a second version to keep in step with D-001.

## D-003 — Decisions bind until superseded
Date: 2026-01-03
Decision: An entry binds until a later D-NNN supersedes it, with the human's go-ahead.
Rationale: Otherwise every session re-litigates the log.
Consequences: \`Superseded-by:\` is the only way out.
`

/**
 * Split a single-file log into state/decisions/<ID>.md, the way a migration
 * does. Used to prove both layouts produce the SAME index — the property that
 * makes the migration a split rather than a rewrite.
 */
async function splitLog(root, source = SOURCE) {
  const lines = source.split('\n')
  await fs.mkdir(path.join(root, DECISIONS_DIR), { recursive: true })
  const starts = []
  lines.forEach((l, i) => { if (/^##\s+D-\d{3}\b/.test(l)) starts.push(i) })
  for (let k = 0; k < starts.length; k++) {
    const body = lines.slice(starts[k], starts[k + 1] ?? lines.length).join('\n').trimEnd()
    const id = body.match(/^##\s+(D-\d{3})/)[1]
    await fs.writeFile(path.join(root, decisionPath(id)), body + '\n')
  }
  await fs.rm(path.join(root, SOURCE_REL), { force: true })
  return starts.length
}

describe('buildIndex — content', () => {
  it('carries every title verbatim and nothing else', () => {
    const srcLines = SOURCE.split('\n')
    const index = buildIndex(srcLines)

    // Independently re-derive the titles from the source and require an exact
    // match — the index must never paraphrase, truncate or re-order.
    const sourceTitles = []
    for (const line of srcLines) {
      const h = line.match(/^##\s+(D-\d{3})\s+—\s+(.+)$/)
      if (h) sourceTitles.push([h[1], h[2]])
    }
    assert.equal(sourceTitles.length, 3, 'fixture sanity: three entries')

    const indexLines = index.split('\n')
    for (const [id, title] of sourceTitles) {
      assert.ok(indexLines.includes(`- **${id}** — ${title}`),
        `${id} title must appear verbatim in the index`)
    }
    // D-087: the Decision: line is what made the index grow 77 tokens/entry.
    // Its return would silently undo the change, so it is asserted absent.
    assert.doesNotMatch(index, /^\s*Decision:/m,
      'the slim index carries no Decision: line — that is the whole point of D-087')
  })

  it('indexes an entry even when its body is incomplete', () => {
    const index = buildIndex([
      '# Decisions',
      '',
      '## D-009 — A decision recorded without its Decision: line',
      'Date: 2026-01-09',
      'Rationale: someone was in a hurry.',
    ])
    // An entry the index silently dropped would be invisible to every session.
    assert.match(index, /- \*\*D-009\*\* — A decision recorded without its Decision: line/)
  })

  it('ignores D-NNN headings inside fenced code (format examples are not entries)', () => {
    const entries = parseDecisionEntries([
      '# Decisions',
      '```',
      '## D-999 — template shown as an example',
      'Decision: …',
      '```',
      '## D-010 — a real one',
      'Decision: real.',
    ])
    assert.deepEqual(entries.map(e => e.id), ['D-010'])
  })

  it('is a pure function of the source — same input, same bytes', () => {
    assert.equal(buildIndex(SOURCE.split('\n')), buildIndex(SOURCE.split('\n')))
  })

  it('marks a superseded or challenged entry on its title line', () => {
    // ST-10 proves the index MATCHES its source, never that it SAYS ENOUGH. An
    // entry that is dead or contested would otherwise read as live and
    // uncontested to any session that stops at the index.
    const index = buildIndex([
      '# Decisions',
      '',
      '## D-001 — Live one',
      '',
      'Decision: Stays.',
      '',
      '## D-002 — Dead one',
      '',
      'Decision: Replaced.',
      'Superseded-by: D-004',
      '',
      '## D-003 — Contested one',
      '',
      'Decision: Under review.',
      'Challenged-by: OD-009',
    ])
    assert.match(index, /- \*\*D-001\*\* — Live one/)
    assert.match(index, /- \*\*D-002\*\* \(superseded by D-004\) — Dead one/)
    assert.match(index, /- \*\*D-003\*\* \(challenged by OD-009\) — Contested one/)
  })

  it('holds one entry to exactly one line (the abort condition of D-087)', () => {
    // If a real entry ever needs more than its title, the decision grammar is
    // the problem — not the file size. Guard it here rather than discovering it
    // as bloat two hundred decisions later.
    const body = buildIndex(SOURCE.split('\n')).split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('>'))
    assert.equal(body.length, 3, 'three entries → three lines')
    for (const line of body) {
      assert.match(line, /^- \*\*D-\d{3}\*\*/, `every body line is one entry, got: ${line}`)
    }
  })
})

// ── THE FORM LOCK ────────────────────────────────────────────────────────────
describe('buildIndex — form (this is what keeps RF-03 at zero)', () => {
  it('defines no ID at all — the index is pure reference', () => {
    const index = buildIndex(SOURCE.split('\n'))
    assert.deepEqual(
      parseIdDefinitions(index.split('\n'), IDS),
      [],
      'an index entry must never parse as an ID definition — headings here would '
      + 'mean one RF-03 error per decision in the workspace',
    )
  })

  it('still references every ID, so nothing goes invisible', () => {
    const refs = parseIdReferences(buildIndex(SOURCE.split('\n')).split('\n'), IDS).map(r => r.id)
    assert.deepEqual([...new Set(refs)].sort(), ['D-001', 'D-002', 'D-003'])
  })

  it('writes bold list items, never headings', () => {
    for (const line of buildIndex(SOURCE.split('\n')).split('\n')) {
      if (!line.trim()) continue
      assert.doesNotMatch(line, /^#{1,6}\s+D-\d{3}/, 'no heading may carry an ID')
      if (line.startsWith('- ')) {
        assert.match(line, /^- \*\*D-\d{3}\*\*/,
          'the ID token must be wrapped in ** so ID_LIST_RE cannot match it')
      }
    }
  })

  it('survives a source whose own IDs would collide — 42 entries, still zero definitions', () => {
    const many = ['# Decisions', '']
    for (let n = 1; n <= 42; n++) {
      const id = `D-${String(n).padStart(3, '0')}`
      many.push(`## ${id} — Entry number ${n}`, `Date: 2026-01-01`, `Decision: Do thing ${n}.`, '')
    }
    const index = buildIndex(many)
    assert.equal(parseIdDefinitions(index.split('\n'), IDS).length, 0)
    assert.equal((index.match(/^- \*\*D-\d{3}\*\*/gm) || []).length, 42)
  })
})

// ── THE TWO LAYOUTS ──────────────────────────────────────────────────────────
describe('readDecisionSource — one code path, two forms (D-077, D-087)', () => {
  it('reads the legacy single file when there is no directory', async () => {
    const root = await makeRoot('truss-didx-form-file-')
    await fs.mkdir(path.join(root, 'state'), { recursive: true })
    await fs.writeFile(path.join(root, SOURCE_REL), SOURCE)

    const src = await readDecisionSource(root)
    assert.equal(src.form, 'file')
    assert.deepEqual(src.files, [SOURCE_REL])
    assert.equal(parseDecisionEntries(src.lines).length, 3)
  })

  it('reads the split directory, and both forms build the identical index', async () => {
    const root = await makeRoot('truss-didx-form-dir-')
    await fs.mkdir(path.join(root, 'state'), { recursive: true })
    await fs.writeFile(path.join(root, SOURCE_REL), SOURCE)
    const fromFile = buildIndex((await readDecisionSource(root)).lines)

    assert.equal(await splitLog(root), 3)
    const src = await readDecisionSource(root)
    assert.equal(src.form, 'dir')
    assert.deepEqual(src.files, ['D-001', 'D-002', 'D-003'].map(decisionPath))

    // The migration is a split, not a rewrite: same bytes out.
    assert.equal(buildIndex(src.lines), fromFile)
  })

  it('falls back to the file when the directory exists but holds no body', async () => {
    // Creating state/decisions/ by accident must not blank a workspace's index.
    const root = await makeRoot('truss-didx-form-empty-')
    await fs.mkdir(path.join(root, DECISIONS_DIR), { recursive: true })
    await fs.writeFile(path.join(root, SOURCE_REL), SOURCE)
    await fs.writeFile(path.join(root, DECISIONS_DIR, 'README.md'), '# not a decision\n')

    const src = await readDecisionSource(root)
    assert.equal(src.form, 'file', 'only D-NNN.md counts as a body')
    assert.equal(parseDecisionEntries(src.lines).length, 3)
  })

  it('orders the directory by ID, not by readdir order', async () => {
    const root = await makeRoot('truss-didx-form-order-')
    await fs.mkdir(path.join(root, DECISIONS_DIR), { recursive: true })
    for (const n of [12, 3, 7]) {
      const id = `D-${String(n).padStart(3, '0')}`
      await fs.writeFile(path.join(root, decisionPath(id)), `## ${id} — Entry ${n}\nDate: 2026-01-01\nDecision: d.\n`)
    }
    const entries = parseDecisionEntries((await readDecisionSource(root)).lines)
    assert.deepEqual(entries.map(e => e.id), ['D-003', 'D-007', 'D-012'])
  })

  it('returns null when the workspace has no decision log at all', async () => {
    const root = await makeRoot('truss-didx-form-none-')
    assert.equal(await readDecisionSource(root), null)
  })
})

describe('ST-10 — the index against its source', () => {
  it('is silent right after init, and init ships the index', async () => {
    const root = await makeRoot('truss-didx-init-')
    await runInit(root, ['--name', 'Indexed', '--lang', 'English'])

    await assert.doesNotReject(() => read(root, INDEX_REL), 'init writes the index')
    const findings = await runChecks(root)
    assert.deepEqual(ids(findings, 'ST-10'), [], 'a fresh workspace has nothing to report')
    // …and the index did not make the generated map stale either.
    assert.deepEqual(ids(findings, 'ST-07'), [], 'init writes the index before the map')
    assert.equal(errorsOf(findings).length, 0)
  })

  it('reports I — not W — when the index has never been generated', async () => {
    const root = await makeRoot('truss-didx-absent-')
    await runInit(root, ['--name', 'Indexed', '--lang', 'English'])
    // init ships no decision log (D-087: state/decisions/ is on demand), so a
    // log has to exist for there to be anything to index.
    await fs.writeFile(path.join(root, SOURCE_REL), SOURCE)
    await fs.rm(path.join(root, INDEX_REL))

    const f = ids(await runChecks(root), 'ST-10')
    assert.equal(f.length, 1)
    // D-081: `doctor` exits 1 on a W, so a missing index must not un-green every
    // workspace that predates the index. Not having taken a step is not a defect.
    assert.equal(f[0].severity, 'I')
    assert.match(f[0].fix, /render/)
  })

  it('reports W when the index disagrees with the log — in either layout', async () => {
    for (const layout of ['file', 'dir']) {
      const root = await makeRoot(`truss-didx-stale-${layout}-`)
      await runInit(root, ['--name', 'Indexed', '--lang', 'English'])
      const entry = '## D-001 — Added after the index was written\nDate: 2026-01-01\n'
        + 'Decision: Something the index has never heard of.\nRationale: r.\nConsequences: c.\n'

      if (layout === 'file') {
        await fs.writeFile(path.join(root, SOURCE_REL), '# Decisions\n\n' + entry)
      } else {
        await fs.mkdir(path.join(root, DECISIONS_DIR), { recursive: true })
        await fs.writeFile(path.join(root, decisionPath('D-001')), entry)
      }

      const f = ids(await runChecks(root), 'ST-10')
      assert.equal(f.length, 1, `${layout}: exactly one finding`)
      assert.equal(f[0].severity, 'W', `${layout}: a stale index is a file that lies`)
      assert.equal(f[0].file, INDEX_REL)
    }
  })

  it('reports W for a hand-edit of the index itself', async () => {
    const root = await makeRoot('truss-didx-handedit-')
    await runInit(root, ['--name', 'Indexed', '--lang', 'English'])
    await fs.writeFile(path.join(root, SOURCE_REL), SOURCE)
    await writeIndex(root)
    const abs = path.join(root, INDEX_REL)
    await fs.writeFile(abs, (await fs.readFile(abs, 'utf8')) + '\n- **D-404** — invented by hand\n')

    const f = ids(await runChecks(root), 'ST-10')
    assert.equal(f.length, 1)
    assert.equal(f[0].severity, 'W')
  })

  it('compares content, not mtime — touching the log changes nothing', async () => {
    const root = await makeRoot('truss-didx-mtime-')
    await runInit(root, ['--name', 'Indexed', '--lang', 'English'])
    await fs.writeFile(path.join(root, SOURCE_REL), SOURCE)
    await writeIndex(root)
    const later = new Date(Date.now() + 60_000)
    await fs.utimes(path.join(root, SOURCE_REL), later, later)

    assert.deepEqual(ids(await runChecks(root), 'ST-10'), [])
  })

  it('stays silent when there is no decision log to be stale against', async () => {
    // This is what a fresh workspace looks like since D-087: no bodies yet.
    const root = await makeRoot('truss-didx-nosource-')
    await runInit(root, ['--name', 'Indexed', '--lang', 'English'])
    await fs.rm(path.join(root, SOURCE_REL), { force: true })
    await fs.rm(path.join(root, INDEX_REL))

    // ST-01 owns the missing file; ST-10 has nothing to say about it.
    assert.deepEqual(ids(await runChecks(root), 'ST-10'), [])
  })
})

describe('writeIndex on a real workspace', () => {
  for (const layout of ['file', 'dir']) {
    it(`indexes a full decision log without producing a single RF-02/RF-03 (${layout})`, async () => {
      const root = await makeRoot(`truss-didx-real-${layout}-`)
      await runInit(root, ['--name', 'Indexed', '--lang', 'English'])

      const log = ['# Decisions', '']
      for (let n = 1; n <= 42; n++) {
        const id = `D-${String(n).padStart(3, '0')}`
        log.push(
          `## ${id} — Entry number ${n}`,
          'Date: 2026-01-01',
          `Decision: Do thing ${n}${n > 1 ? `, replacing what D-001 said` : ''}.`,
          'Rationale: r.',
          'Consequences: c.',
          '',
        )
      }
      await fs.writeFile(path.join(root, SOURCE_REL), log.join('\n'))
      if (layout === 'dir') await splitLog(root, log.join('\n'))

      const res = await writeIndex(root)
      assert.equal(res.entries, 42)
      assert.equal(res.form, layout)

      const findings = await runChecks(root)
      assert.deepEqual(ids(findings, 'ST-10'), [])
      assert.deepEqual(
        ids(findings, 'RF-03').map(f => f.message), [],
        'the index must not define any ID a second time',
      )
      // The bodies must be loaded, or every D-NNN reference becomes an RF-02.
      assert.deepEqual(ids(findings, 'RF-02').map(f => f.message), [])
    })
  }

  it('returns null (not a throw) when there is nothing to index', async () => {
    const root = await makeRoot('truss-didx-null-')
    assert.equal(await writeIndex(root), null)
  })
})
