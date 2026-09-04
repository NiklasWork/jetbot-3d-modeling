// .truss/tests/presence.test.mjs — parallel-session visibility (D-101).
//
// What is locked here is the set of properties the mechanism was built for, and
// every one of them is a way it could rot instead:
//   1. Reading prunes. There is no cleanup command, so if reading ever stops
//      removing dead records, the directory grows without bound forever.
//   2. A hung session KEEPS its record — it is still present, and dropping it
//      would under-report.
//   3. EPERM means alive. Reading it as dead buries every other user's session,
//      and missing a session is the dangerous direction.
//   4. A foreign HOST is never judged and never deleted.
//   5. Silence when there is nothing to say. A line on every run is noise, and
//      noise is how a finding stops being read.

import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  PRESENCE_REL_DIR, EPOCH_TOLERANCE_S,
  bootEpoch, alive, coreSnapshot,
  readPresence, writePresence, journalDiff, presenceLines, observe, indexLockAge,
} from '../lib/presence.mjs'

const DEAD_PID = 4_194_303          // above every default pid_max; never a live process

async function tmpRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-presence-'))
  await fs.mkdir(path.join(dir, PRESENCE_REL_DIR), { recursive: true })
  return dir
}

/** Write a record straight to disk, bypassing writePresence, to simulate a foreign session. */
async function seed(root, name, record) {
  await fs.writeFile(path.join(root, PRESENCE_REL_DIR, name), JSON.stringify(record) + '\n', 'utf8')
}

const liveRecord = (over = {}) => ({
  v: 1, host: os.hostname(), boot: bootEpoch(), pid: process.pid,
  comm: 'node', start: null, tool: null,
  started: new Date().toISOString(), seen: new Date().toISOString(),
  first: { dirty: [] }, snapshot: { head: null, dirty: [], core: {} },
  ...over,
})

const names = async (root) => (await fs.readdir(path.join(root, PRESENCE_REL_DIR))).sort()

describe('liveness predicate', () => {
  it('treats an existing process as alive and a missing one as dead', () => {
    assert.equal(alive(process.pid), true)
    assert.equal(alive(DEAD_PID), false)
  })

  it('treats EPERM as ALIVE — a process it may not signal is still a process', () => {
    // The whole point: a naive try/catch would call this dead and silently drop
    // every session belonging to another user. Under-reporting is the dangerous
    // direction, so this branch is asserted directly rather than through a pid
    // that happens to be unsignallable — no such pid exists on every platform
    // (Windows has no pid 1), and a test that only runs on the author's machine
    // is the exact failure L-015 records.
    mock.method(process, 'kill', () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    })
    try {
      assert.equal(alive(process.pid), true)
    } finally {
      mock.restoreAll()
    }
  })

  it('treats a real unsignallable process as alive (POSIX only — pid 1 is init)', { skip: process.platform === 'win32' ? 'no pid 1 on Windows' : false }, () => {
    // Guards the assumption the mock above encodes: that the kernel really does
    // answer EPERM here, not something else.
    assert.equal(alive(1), true)
  })

  it('rejects nonsense pids instead of throwing', () => {
    for (const bad of [0, -1, 1.5, NaN, null, undefined, 'x']) {
      assert.equal(alive(bad), false)
    }
  })
})

describe('reading prunes — there is no cleanup command', () => {
  it('removes a killed session, keeps a live one, in ONE read', async () => {
    const root = await tmpRoot()
    await seed(root, 'h__1.json', liveRecord({ pid: DEAD_PID }))
    await seed(root, 'h__2.json', liveRecord())                       // this process → alive
    const { live, pruned } = await readPresence(root)
    assert.equal(live.length, 1)
    assert.equal(pruned, 1)
    assert.deepEqual(await names(root), ['h__2.json'])
  })

  it('removes a record from a foreign boot epoch (pid reused across a reboot)', async () => {
    const root = await tmpRoot()
    // Same pid as this live process, but stamped with a boot that is not ours.
    await seed(root, 'h__1.json', liveRecord({ boot: bootEpoch() - (EPOCH_TOLERANCE_S + 3600) }))
    const { live, pruned } = await readPresence(root)
    assert.equal(live.length, 0, 'a live pid must not rescue a record from another boot')
    assert.equal(pruned, 1)
    assert.deepEqual(await names(root), [])
  })

  it('keeps a record whose boot epoch differs only by suspend/NTP drift', async () => {
    const root = await tmpRoot()
    await seed(root, 'h__1.json', liveRecord({ boot: bootEpoch() - Math.floor(EPOCH_TOLERANCE_S / 2) }))
    const { live } = await readPresence(root)
    assert.equal(live.length, 1, 'too tight a tolerance would delete a LIVE session — under-reporting')
  })

  it('removes junk: bad JSON, an empty file, a missing pid, a .tmp leftover', async () => {
    const root = await tmpRoot()
    await fs.writeFile(path.join(root, PRESENCE_REL_DIR, 'h__1.json'), '{not json', 'utf8')
    await fs.writeFile(path.join(root, PRESENCE_REL_DIR, 'h__2.json'), '', 'utf8')
    await seed(root, 'h__3.json', { host: os.hostname(), boot: bootEpoch() })   // no pid
    await fs.writeFile(path.join(root, PRESENCE_REL_DIR, 'h__4.json.99.tmp'), '{"half":', 'utf8')
    await seed(root, 'h__5.json', liveRecord())

    const { live, pruned } = await readPresence(root)
    assert.equal(live.length, 1)
    assert.equal(pruned, 4)
    assert.deepEqual(await names(root), ['h__5.json'])
  })

  it('never judges and never deletes a record from another host', async () => {
    const root = await tmpRoot()
    await seed(root, 'other__7.json', liveRecord({ host: `${os.hostname()}-elsewhere`, pid: DEAD_PID }))
    const { live, pruned, foreignHost } = await readPresence(root)
    assert.equal(foreignHost, 1)
    assert.equal(live.length, 0, 'a foreign host is not counted…')
    assert.equal(pruned, 0, '…and is not deleted either')
    assert.deepEqual(await names(root), ['other__7.json'])
  })

  it('survives a missing directory — someone deleted .truss/out mid-run', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-presence-gone-'))
    const res = await readPresence(root)
    assert.deepEqual(res, { live: [], foreignHost: 0, pruned: 0 })
  })

  it('scales: 200 dead records collapse to the one live record in a single read', async () => {
    const root = await tmpRoot()
    for (let i = 0; i < 200; i++) await seed(root, `h__d${i}.json`, liveRecord({ pid: DEAD_PID - i }))
    await seed(root, 'h__live.json', liveRecord())
    const { live, pruned } = await readPresence(root)
    assert.equal(live.length, 1)
    assert.equal(pruned, 200)
    assert.deepEqual(await names(root), ['h__live.json'])
  })
})

describe('a hung session keeps its record', () => {
  it('an old record whose process still runs stays — it IS still present', async () => {
    const root = await tmpRoot()
    const hoursAgo = new Date(Date.now() - 6 * 3600_000).toISOString()
    await seed(root, 'h__1.json', liveRecord({ started: hoursAgo, seen: hoursAgo }))
    const { live, pruned } = await readPresence(root)
    assert.equal(live.length, 1, 'age must never be the criterion — liveness is')
    assert.equal(pruned, 0)
  })
})

describe('writing is atomic and never fatal', () => {
  it('leaves no .tmp behind and can be read back', async () => {
    const root = await tmpRoot()
    const self = { pid: process.pid, comm: 'node', start: null }
    const written = await writePresence(root, self, { head: 'abc1234', dirty: ['a.md'], core: { 'x.md': 'h1' } })
    assert.ok(written)
    assert.equal(written.first.dirty[0], 'a.md')
    assert.ok((await names(root)).every(n => !n.includes('.tmp')))
  })

  it('keeps `first` from the session\'s FIRST run across later runs', async () => {
    const root = await tmpRoot()
    const self = { pid: process.pid, comm: 'node', start: null }
    const first = await writePresence(root, self, { dirty: ['was-here-before.md'] })
    const later = await writePresence(root, self, { dirty: ['mine.md'], previous: first })
    assert.deepEqual(later.first.dirty, ['was-here-before.md'])
    assert.deepEqual(later.snapshot.dirty, ['mine.md'])
    assert.equal(later.started, first.started, 'session start time must not drift forward')
  })

  it('returns null instead of throwing when identity is unknown', async () => {
    const root = await tmpRoot()
    assert.equal(await writePresence(root, null, {}), null)
  })
})

describe('journal — what changed since MY last run', () => {
  const prev = {
    seen: new Date(Date.now() - 14 * 60_000).toISOString(),
    first: { dirty: ['secrets.enc.env', 'scripts/secrets.sh'] },
    snapshot: { head: 'aaa1111', dirty: [], core: { 'state/current.md': 'h1', 'VISION.md': 'h2' } },
  }

  it('reports a changed core file and a moved HEAD', () => {
    const d = journalDiff(prev, { head: 'bbb2222', dirty: [], core: { 'state/current.md': 'CHANGED', 'VISION.md': 'h2' } })
    assert.deepEqual(d.coreChanged, ['state/current.md'])
    assert.deepEqual(d.headMoved, { from: 'aaa1111', to: 'bbb2222' })
    assert.equal(d.minutes, 14)
  })

  it('says nothing when nothing moved', () => {
    const d = journalDiff(prev, { head: 'aaa1111', dirty: [], core: { 'state/current.md': 'h1', 'VISION.md': 'h2' } })
    assert.deepEqual(d.coreChanged, [])
    assert.equal(d.headMoved, null)
  })

  it('notices a core file that appeared or vanished', () => {
    const gone = journalDiff(prev, { head: 'aaa1111', core: { 'VISION.md': 'h2' } })
    assert.deepEqual(gone.coreChanged, ['state/current.md'])
  })

  it('names only paths that were already dirty when the session began', () => {
    const d = journalDiff(prev, { head: 'aaa1111', dirty: ['secrets.enc.env', 'my-new-file.md'], core: prev.snapshot.core })
    assert.deepEqual(d.preexisting, ['secrets.enc.env'], 'own new work must not be reported as pre-existing')
  })

  it('is empty and safe on a first run (no previous record)', () => {
    const d = journalDiff(null, { head: 'x', dirty: ['a'], core: {} })
    assert.deepEqual(d, { coreChanged: [], headMoved: null, preexisting: [], minutes: null })
  })
})

describe('rendering — silence is the default', () => {
  const quiet = { sessions: 1, others: [], identity: true, foreignHost: 0, diff: journalDiff(null) }

  it('prints NOTHING for one session in a quiet tree', () => {
    assert.deepEqual(presenceLines(quiet, { lockAgeMs: null }), [])
  })

  it('prints nothing when identity is unknown and nothing moved (Windows)', () => {
    const unknown = { sessions: null, others: [], identity: false, foreignHost: 0, diff: journalDiff(null) }
    assert.deepEqual(presenceLines(unknown, { lockAgeMs: null }), [])
  })

  it('never claims a session count it could not establish', () => {
    const unknown = {
      sessions: null, others: [], identity: false, foreignHost: 0,
      diff: journalDiff({ seen: new Date().toISOString(), first: { dirty: [] }, snapshot: { head: 'a', core: {} } },
        { head: 'b', core: {} }),
    }
    const out = presenceLines(unknown, { lockAgeMs: null }).join('\n')
    assert.ok(!/sessions live/.test(out), 'a wrong count is worse than no count')
    assert.match(out, /Changed since your last truss run/, 'the journal half still works without identity')
  })

  it('names the pre-existing paths and gives the executable alternative', () => {
    const obs = {
      sessions: 2, identity: true, foreignHost: 0,
      others: [{ pid: 4242, tool: 'claude-code', started: new Date(Date.now() - 130 * 60_000).toISOString() }],
      diff: journalDiff(
        { seen: new Date().toISOString(), first: { dirty: ['secrets.enc.env'] }, snapshot: { head: 'a', core: {} } },
        { head: 'a', dirty: ['secrets.enc.env'], core: {} }),
    }
    const out = presenceLines(obs, { lockAgeMs: null }).join('\n')
    assert.match(out, /2 sessions live/)
    assert.match(out, /claude-code\(4242\) since 2h10/)
    assert.match(out, /secrets\.enc\.env/)
    assert.match(out, /git commit -- /, 'the line must carry the action, not only the warning')
  })

  it('contradicts git\'s advice to delete index.lock', () => {
    const out = presenceLines(quiet, { lockAgeMs: 3000 }).join('\n')
    assert.match(out, /index\.lock exists, 3s old/)
    assert.match(out, /do not delete the lock/)
    assert.match(out, /wait ~2s and repeat/)
  })
})

describe('observe — the whole path, and its off switch', () => {
  it('TRUSS_NO_PRESENCE disables it without writing anything', async () => {
    const root = await tmpRoot()
    process.env.TRUSS_NO_PRESENCE = '1'
    try {
      const obs = await observe(root, { head: 'a', dirty: [] })
      assert.equal(obs.sessions, null)
      assert.equal(obs.identity, false)
      assert.deepEqual(presenceLines(obs, {}), [])
      assert.deepEqual(await names(root), [], 'the off switch must not leave a record behind')
    } finally { delete process.env.TRUSS_NO_PRESENCE }
  })

  it('never throws, even on a root that does not exist', async () => {
    const obs = await observe(path.join(os.tmpdir(), 'truss-does-not-exist-' + process.pid), {})
    assert.ok(obs && typeof obs === 'object')
  })
})

describe('helpers', () => {
  it('indexLockAge returns null when there is no lock', async () => {
    assert.equal(await indexLockAge(await tmpRoot()), null)
  })

  it('coreSnapshot skips absent files instead of inventing entries', async () => {
    const root = await tmpRoot()
    await fs.writeFile(path.join(root, 'VISION.md'), '# V\n', 'utf8')
    const snap = await coreSnapshot(root)
    assert.ok(snap['VISION.md'], 'a present boot file is hashed')
    assert.equal(snap['state/current.md'], undefined, 'an absent file is a legitimate state')
  })

  it('bootEpoch is stable across calls', () => {
    assert.ok(Math.abs(bootEpoch() - bootEpoch()) <= 1)
  })
})
