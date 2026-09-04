// .truss/tests/context-ack.test.mjs — the boot-context review record.
//
// Two things are locked here, and they are the whole point of the mechanism:
//   1. An ack DOWNGRADES a warning, it never hides it — the number stays visible.
//   2. An ack NEVER touches an error. If that ever regresses, a workspace could
//      buy silence on unambiguous ballast, which is the failure this design
//      exists to avoid.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  ACK_HEADROOM, ACK_REL_PATH, ACKABLE,
  readContextAck, writeContextAck, clearContextAck, ackVerdict,
} from '../lib/context-ack.mjs'
import * as cx from '../checks/cx.mjs'

const execFileP = promisify(execFile)
const ENGINE = path.join(fileURLToPath(import.meta.url), '..', '..')

const ids = (findings, id) => findings.filter(f => f.id === id)
const big = (words) => '# Big\n\n' + Array(words).fill('lorem').join(' ') + '\n'
function file(content) {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return { lines, content, stat: { mtimeMs: Date.now() } }
}
function ctxOf(files = {}, { ack = null } = {}) {
  return {
    files: new Map(Object.entries(files)),
    phases: { frontmatter: {}, defs: new Map() },
    diskPaths: [], root: '/tmp/none',
    contextAck: ack ? { version: 1, acks: { 'CX-01': ack } } : null,
  }
}

// ── ackVerdict (pure) ────────────────────────────────────────────────────────
describe('ackVerdict', () => {
  it('downgrades inside the headroom', () => {
    const v = ackVerdict({ tokens: 20000, date: '2026-08-02' }, 21000, 'W')
    assert.equal(v.downgraded, true)
    assert.equal(v.baseline, 20000)
    assert.equal(v.ceiling, Math.round(20000 * (1 + ACK_HEADROOM)))
  })

  it('does not downgrade past the ceiling, but still reports the stale baseline', () => {
    const v = ackVerdict({ tokens: 20000, date: '2026-08-02' }, 24000, 'W')
    assert.equal(v.downgraded, false)
    assert.equal(v.baseline, 20000) // caller can name the outgrown baseline
  })

  it('is exact at the ceiling (inclusive)', () => {
    const ceiling = Math.round(20000 * (1 + ACK_HEADROOM))
    assert.equal(ackVerdict({ tokens: 20000 }, ceiling, 'W').downgraded, true)
    assert.equal(ackVerdict({ tokens: 20000 }, ceiling + 1, 'W').downgraded, false)
  })

  it('NEVER downgrades an error, however generous the ack', () => {
    const v = ackVerdict({ tokens: 999999, date: '2026-08-02' }, 40000, 'E')
    assert.equal(v.downgraded, false)
    assert.equal(v.baseline, null)
  })

  it('treats a missing or malformed ack as unreviewed', () => {
    for (const bad of [null, undefined, {}, { tokens: 0 }, { tokens: -5 }, { tokens: 'x' }, { tokens: NaN }]) {
      assert.equal(ackVerdict(bad, 20000, 'W').downgraded, false)
    }
  })

  it('only CX-01 is ackable', () => {
    assert.deepEqual([...ACKABLE], ['CX-01'])
  })
})

// ── CX-01 wiring ─────────────────────────────────────────────────────────────
describe('CX-01 with a review baseline', () => {
  it('reports info, not warn, inside the headroom — and keeps the number visible', async () => {
    const ctx = ctxOf({ 'VISION.md': file(big(13000)) }, { ack: { tokens: 19500, date: '2026-08-02' } })
    const [f] = ids(await cx.run(ctx), 'CX-01')
    assert.equal(f.severity, 'I')
    assert.match(f.message, /19500/)          // current measurement still shown
    assert.match(f.message, /reviewed baseline/)
    assert.match(f.message, /2026-08-02/)     // when it was reviewed
    assert.match(f.message, /Warns again above/)
  })

  it('warns again once growth passes the ceiling, naming the outgrown baseline', async () => {
    const ctx = ctxOf({ 'VISION.md': file(big(13000)) }, { ack: { tokens: 15000, date: '2026-07-01' } })
    const [f] = ids(await cx.run(ctx), 'CX-01')
    assert.equal(f.severity, 'W')
    assert.match(f.message, /Grown past the reviewed baseline/)
  })

  it('an ack cannot downgrade the error band', async () => {
    const ctx = ctxOf({ 'VISION.md': file(big(21000)) }, { ack: { tokens: 31500, date: '2026-08-02' } })
    const [f] = ids(await cx.run(ctx), 'CX-01')
    assert.equal(f.severity, 'E')
  })

  it('behaves exactly as before when no ack exists', async () => {
    const [f] = ids(await cx.run(ctxOf({ 'VISION.md': file(big(13000)) })), 'CX-01')
    assert.equal(f.severity, 'W')
    assert.doesNotMatch(f.message, /baseline/)
  })
})

// ── persistence ──────────────────────────────────────────────────────────────
describe('ack file', () => {
  const tmp = async () => fs.mkdtemp(path.join(os.tmpdir(), 'truss-ack-'))

  it('round-trips and merges rather than overwriting', async () => {
    const root = await tmp()
    assert.equal(await readContextAck(root), null)
    await writeContextAck(root, 'CX-01', { tokens: 19500.4, note: 'all live' })
    const rec = await readContextAck(root)
    assert.equal(rec.acks['CX-01'].tokens, 19500) // rounded
    assert.equal(rec.acks['CX-01'].note, 'all live')
    assert.match(rec.acks['CX-01'].date, /^\d{4}-\d{2}-\d{2}$/)
  })

  it('refuses a check that is not ackable', async () => {
    const root = await tmp()
    await assert.rejects(() => writeContextAck(root, 'ST-01', { tokens: 100 }))
  })

  it('survives a corrupt file by reporting "unreviewed" instead of throwing', async () => {
    const root = await tmp()
    await fs.mkdir(path.join(root, '.truss', 'out'), { recursive: true })
    await fs.writeFile(path.join(root, ACK_REL_PATH), '{ not json', 'utf8')
    assert.equal(await readContextAck(root), null)
  })

  it('clear distinguishes removed from absent — a failed delete must never read as "nothing there"', async () => {
    const root = await tmp()
    await writeContextAck(root, 'CX-01', { tokens: 19500 })
    assert.equal(await clearContextAck(root), 'removed')
    assert.equal(await clearContextAck(root), 'absent')
    assert.equal(await readContextAck(root), null)
  })

  it('an empty acks map reads as unreviewed (the neutralised state)', async () => {
    const root = await tmp()
    await fs.mkdir(path.join(root, '.truss', 'out'), { recursive: true })
    await fs.writeFile(path.join(root, ACK_REL_PATH), JSON.stringify({ version: 1, acks: {} }), 'utf8')
    const rec = await readContextAck(root)
    assert.equal(ackVerdict(rec.acks['CX-01'], 20000, 'W').downgraded, false)
  })
})

// ── CLI surface ──────────────────────────────────────────────────────────────
describe('truss ack (CLI)', () => {
  it('rejects an unknown target', async () => {
    await assert.rejects(
      () => execFileP(process.execPath, [path.join(ENGINE, 'bin', 'truss.mjs'), 'ack', 'nonsense']),
      (err) => /unknown target/.test(err.stderr),
    )
  })

  it('is dispatchable and documented in lockstep', async () => {
    const { COMMAND_META } = await import('../lib/command-meta.mjs')
    const meta = COMMAND_META.find(c => c.name === 'ack')
    assert.ok(meta, 'ack missing from COMMAND_META')
    const cli = await fs.readFile(path.join(ENGINE, 'docs', 'cli.md'), 'utf8')
    assert.match(cli, /^## `ack`$/m)
  })
})
