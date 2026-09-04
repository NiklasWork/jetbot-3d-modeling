// .truss/tests/engine-manifest.test.mjs — engine integrity manifest (D-070)
// Run with: node --test .truss/tests/engine-manifest.test.mjs
//
// Covers lib/engine-manifest.mjs directly (generation, verification, the
// out/ + prompts/custom/ scope cut) and checks/st.mjs's ST-09, driven straight
// against the check module — workspace.test.mjs and checks.test.mjs are owned
// elsewhere, so ST-09 is exercised here instead of there.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  MANIFEST_REL, computeEngineHashes, formatManifest,
  writeManifest, readManifest, verifyEngine,
} from '../lib/engine-manifest.mjs'
import { loadWorkspace } from '../lib/workspace.mjs'
import * as st from '../checks/st.mjs'

// Shared fixture workspace (used read-only elsewhere too): ships a real
// .truss/ with VERSION and bin/truss.mjs, and no MANIFEST.sha256.
const FIXTURE = path.join(fileURLToPath(import.meta.url), '..', 'fixture')

async function mkTmp(tag) {
  return fs.mkdtemp(path.join(os.tmpdir(), `truss-manifest-${tag}-`))
}

/** A small fake engine dir with files inside and outside the excluded scope. */
async function makeFakeEngine() {
  const dir = await mkTmp('fake-engine')
  await fs.mkdir(path.join(dir, 'lib'), { recursive: true })
  await fs.mkdir(path.join(dir, 'out'), { recursive: true })
  await fs.mkdir(path.join(dir, 'prompts', 'custom'), { recursive: true })
  await fs.mkdir(path.join(dir, 'prompts', 'shipped'), { recursive: true })
  await fs.writeFile(path.join(dir, 'VERSION'), '1.0.0\n')
  await fs.writeFile(path.join(dir, 'lib', 'a.mjs'), 'export const a = 1\n')
  await fs.writeFile(path.join(dir, 'out', 'doctor.json'), '{"stale":true}\n')
  await fs.writeFile(path.join(dir, 'prompts', 'custom', 'mine.md'), 'user content\n')
  await fs.writeFile(path.join(dir, 'prompts', 'shipped', 'x.md'), 'shipped\n')
  return dir
}

describe('engine-manifest: generation', () => {
  it('computeEngineHashes covers engine files, excludes out/ and prompts/custom/', async () => {
    const dir = await makeFakeEngine()
    const entries = await computeEngineHashes(dir)
    assert.deepEqual(entries.map(e => e.rel), ['VERSION', 'lib/a.mjs', 'prompts/shipped/x.md'])
    for (const e of entries) assert.match(e.sha, /^[0-9a-f]{64}$/)
  })

  it('formatManifest is byte-stable and sorted regardless of input order', async () => {
    const dir = await makeFakeEngine()
    const entries = await computeEngineHashes(dir)
    const a = formatManifest(entries)
    const b = formatManifest([...entries].reverse())  // write twice, differently ordered
    assert.equal(a, b)
    assert.equal(
      a,
      [...entries].sort((x, y) => (x.rel < y.rel ? -1 : 1)).map(e => `${e.sha}  ${e.rel}`).join('\n') + '\n',
    )
    assert.equal(a.includes('\r'), false)
    assert.equal(a.endsWith('\n'), true)
  })

  it('writeManifest writes MANIFEST_REL at the engine root and returns the entry count', async () => {
    const dir = await makeFakeEngine()
    const count = await writeManifest(dir)
    assert.equal(count, 3)
    const raw = await fs.readFile(path.join(dir, MANIFEST_REL), 'utf8')
    assert.match(raw, /^[0-9a-f]{64} {2}VERSION\n/m)
  })
})

describe('engine-manifest: verification', () => {
  it('is null when there is no manifest', async () => {
    const dir = await makeFakeEngine()
    assert.equal(await verifyEngine(dir), null)
  })

  it('is clean immediately after writeManifest', async () => {
    const dir = await makeFakeEngine()
    await writeManifest(dir)
    assert.deepEqual(await verifyEngine(dir), { modified: [], missing: [], extra: [], unreadable: [] })
  })

  it('flags a changed file as modified', async () => {
    const dir = await makeFakeEngine()
    await writeManifest(dir)
    await fs.writeFile(path.join(dir, 'lib', 'a.mjs'), 'export const a = 2\n')
    assert.deepEqual(await verifyEngine(dir), { modified: ['lib/a.mjs'], missing: [], extra: [], unreadable: [] })
  })

  it('flags a deleted file as missing', async () => {
    const dir = await makeFakeEngine()
    await writeManifest(dir)
    await fs.rm(path.join(dir, 'lib', 'a.mjs'))
    assert.deepEqual(await verifyEngine(dir), { modified: [], missing: ['lib/a.mjs'], extra: [], unreadable: [] })
  })

  it('flags an added file as extra', async () => {
    const dir = await makeFakeEngine()
    await writeManifest(dir)
    await fs.writeFile(path.join(dir, 'lib', 'b.mjs'), 'export const b = 1\n')
    assert.deepEqual(await verifyEngine(dir), { modified: [], missing: [], extra: ['lib/b.mjs'], unreadable: [] })
  })

  it('out/ and prompts/custom/ are invisible in both directions', async () => {
    const dir = await makeFakeEngine()
    await writeManifest(dir)
    await fs.writeFile(path.join(dir, 'out', 'doctor.json'), '{"changed":true}\n')
    await fs.rm(path.join(dir, 'out', 'doctor.json'))
    await fs.writeFile(path.join(dir, 'prompts', 'custom', 'mine.md'), 'edited\n')
    await fs.writeFile(path.join(dir, 'prompts', 'custom', 'new.md'), 'brand new\n')
    assert.deepEqual(await verifyEngine(dir), { modified: [], missing: [], extra: [], unreadable: [] })
  })

  it('readManifest returns null when absent, a rel→sha Map when present', async () => {
    const dir = await makeFakeEngine()
    assert.equal(await readManifest(dir), null)
    await writeManifest(dir)
    const map = await readManifest(dir)
    assert.equal(map.get('VERSION')?.length, 64)
    assert.equal(map.has('out/doctor.json'), false)
  })
})

describe('ST-09: doctor reports engine divergence against the manifest', () => {
  it('stays silent with no manifest (the FIXTURE / pre-D-070 case)', async () => {
    const ctx = await loadWorkspace(FIXTURE)
    const findings = await st.run(ctx)
    assert.equal(findings.filter(f => f.id === 'ST-09').length, 0)
  })

  it('stays silent when the engine matches its manifest', async () => {
    const tmp = await mkTmp('st09-clean')
    await fs.cp(FIXTURE, tmp, { recursive: true })
    await writeManifest(path.join(tmp, '.truss'))
    const ctx = await loadWorkspace(tmp)
    const findings = await st.run(ctx)
    assert.equal(findings.filter(f => f.id === 'ST-09').length, 0)
  })

  it('fires ONE aggregated I-severity finding naming the divergent file', async () => {
    const tmp = await mkTmp('st09-dirty')
    await fs.cp(FIXTURE, tmp, { recursive: true })
    await writeManifest(path.join(tmp, '.truss'))
    await fs.appendFile(path.join(tmp, '.truss', 'bin', 'truss.mjs'), '\n// locally patched\n')
    const ctx = await loadWorkspace(tmp)
    const findings = await st.run(ctx)
    const st09 = findings.filter(f => f.id === 'ST-09')
    assert.equal(st09.length, 1, `expected exactly one ST-09 finding, got ${JSON.stringify(st09)}`)
    assert.equal(st09[0].severity, 'I')
    assert.match(st09[0].message, /1 engine file differs from the release manifest/)
    assert.match(st09[0].message, /modified bin\/truss\.mjs/)
    assert.match(st09[0].fix, /truss upgrade/)
    assert.match(st09[0].fix, /engine was adapted on purpose/)
  })
})

// ── Error paths ──────────────────────────────────────────────────────────────
// Every test above builds an engine it just wrote itself, so all of them pass
// on a version of the module that throws the moment a file cannot be read.
// A review found exactly that: an unreadable engine file escaped as a raw
// EACCES, replacing the whole ST module with one E in `doctor` and aborting
// `truss upgrade` without its usual "nothing was changed" guarantee. These
// tests pin the fixed behaviour — unreadability is a reported state, never an
// exception — plus the manifest-parsing and filename edge cases beside it.

// chmod 000 does not restrict root, so the unreadability tests are meaningless
// (and would fail) in a root container. On Windows, fs.chmod only maps the
// read-only/write attribute and never blocks reads, so the same tests would
// fail there too. Skip rather than silently pass.
const IS_ROOT = process.getuid?.() === 0 || process.platform === 'win32'

describe('engine-manifest: unreadable input is reported, never thrown', () => {
  it('an unreadable FILE lands in unreadable — not modified, not missing', { skip: IS_ROOT }, async () => {
    const dir = await makeFakeEngine()
    await writeManifest(dir)
    const victim = path.join(dir, 'lib', 'a.mjs')
    await fs.chmod(victim, 0o000)
    try {
      const result = await verifyEngine(dir)
      assert.deepEqual(result.unreadable, ['lib/a.mjs'])
      assert.deepEqual(result.modified, [])
      assert.deepEqual(result.missing, [])
      assert.deepEqual(result.extra, [])
    } finally {
      await fs.chmod(victim, 0o644)
    }
  })

  it('an unreadable DIRECTORY reports its files as unreadable, not as missing', { skip: IS_ROOT }, async () => {
    const dir = await makeFakeEngine()
    await writeManifest(dir)
    const victim = path.join(dir, 'lib')
    await fs.chmod(victim, 0o000)
    try {
      const result = await verifyEngine(dir)
      assert.deepEqual(result.unreadable, ['lib/a.mjs'],
        'a subtree that cannot be listed must not be reported as deleted')
      assert.deepEqual(result.missing, [])
      assert.equal(result.extra.some(rel => rel.endsWith('/')), false,
        'the directory sentinel must never leak into extra')
    } finally {
      await fs.chmod(victim, 0o755)
    }
  })

  it('ST-09 names the unreadable file and the other ST checks still run', { skip: IS_ROOT }, async () => {
    const tmp = await mkTmp('st09-unreadable')
    await fs.cp(FIXTURE, tmp, { recursive: true })
    await writeManifest(path.join(tmp, '.truss'))
    const victim = path.join(tmp, '.truss', 'VERSION')
    await fs.chmod(victim, 0o000)
    try {
      const ctx = await loadWorkspace(tmp)
      // The regression this pins: st.run() used to throw here, and the check
      // runner turned that into a single E that replaced ST-01…ST-08 entirely.
      const findings = await st.run(ctx)
      const st09 = findings.filter(f => f.id === 'ST-09')
      assert.equal(st09.length, 1)
      assert.equal(st09[0].severity, 'I')
      assert.match(st09[0].message, /1 unreadable/)
      assert.match(st09[0].message, /unreadable VERSION/)
      assert.equal(findings.every(f => f.id.startsWith('ST-')), true,
        'the ST module must return findings, not blow up the run')
    } finally {
      await fs.chmod(victim, 0o644)
    }
  })
})

describe('engine-manifest: an unusable manifest is treated as no manifest', () => {
  it('parses a CRLF manifest normally instead of dropping every line', async () => {
    const dir = await makeFakeEngine()
    await writeManifest(dir)
    const manifestPath = path.join(dir, MANIFEST_REL)
    const lf = await fs.readFile(manifestPath, 'utf8')
    await fs.writeFile(manifestPath, lf.replace(/\n/g, '\r\n'))

    const map = await readManifest(dir)
    assert.ok(map instanceof Map)
    assert.equal(map.size, (await computeEngineHashes(dir)).length)
    assert.equal([...map.keys()].some(rel => rel.includes('\r')), false)
    assert.deepEqual(await verifyEngine(dir), { modified: [], missing: [], extra: [], unreadable: [] })
  })

  it('an empty or garbage manifest returns null rather than "everything is extra"', async () => {
    for (const body of ['', '\n\n', 'not a manifest at all\n', '# comment only\n']) {
      const dir = await makeFakeEngine()
      await fs.writeFile(path.join(dir, MANIFEST_REL), body)
      assert.equal(await readManifest(dir), null, `body ${JSON.stringify(body)} should be unusable`)
      assert.equal(await verifyEngine(dir), null,
        'an unparseable manifest must stay silent, not accuse every file of being extra')
    }
  })

  it('a partially corrupted manifest keeps its readable lines', async () => {
    const dir = await makeFakeEngine()
    await writeManifest(dir)
    const manifestPath = path.join(dir, MANIFEST_REL)
    const lines = (await fs.readFile(manifestPath, 'utf8')).trimEnd().split('\n')
    await fs.writeFile(manifestPath, ['garbage line', ...lines].join('\n') + '\n')
    const map = await readManifest(dir)
    assert.equal(map.size, lines.length)
  })
})

describe('engine-manifest: filenames a line-based format cannot represent', () => {
  it('refuses to write a manifest when a filename contains a newline', async () => {
    assert.throws(
      () => formatManifest([{ rel: 'ok.md', sha: 'a'.repeat(64) }, { rel: 'bad\nname.md', sha: 'b'.repeat(64) }]),
      /newline/,
    )
  })

  it('round-trips filenames with spaces, which the format does support', async () => {
    const dir = await makeFakeEngine()
    await fs.writeFile(path.join(dir, 'with space.md'), 'x\n')
    await fs.writeFile(path.join(dir, ' leading.md'), 'y\n')
    await writeManifest(dir)
    const map = await readManifest(dir)
    assert.equal(map.has('with space.md'), true)
    assert.equal(map.has(' leading.md'), true)
    assert.deepEqual(await verifyEngine(dir), { modified: [], missing: [], extra: [], unreadable: [] })
  })
})
