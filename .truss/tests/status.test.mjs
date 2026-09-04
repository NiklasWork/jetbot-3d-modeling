import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { execFileSync } from 'node:child_process'

import { runInit } from '../lib/commands/init.mjs'
import { runStatus } from '../lib/commands/status.mjs'
import path from 'node:path'
import { makeRoot } from './helpers.mjs'

test('status uses the configured project name instead of the folder name', async () => {
  const root = await makeRoot('truss-status-name-')
  const output = []
  const originalLog = console.log

  try {
    await runInit(root, ['--name', 'Truss Forge', '--lang', 'English'])
    console.log = (...args) => output.push(args.join(' '))
    await runStatus(root, [])
  } finally {
    console.log = originalLog
    await fs.rm(root, { recursive: true, force: true })
  }

  assert.match(output.join('\n'), /Truss Forge — truss status/)
})

// ── Open decisions in `truss status` (D-036) ─────────────────────────────────
// status is the canonical session-start command, so it is the one place that
// guarantees a question waiting on a human is actually seen.

const captureStatus = async (root) => {
  const output = []
  const originalLog = console.log
  try {
    console.log = (...args) => output.push(args.join(' '))
    await runStatus(root, [])
  } finally { console.log = originalLog }
  return output.join('\n')
}

const OD_FILE = (body) => `# Open Decisions\n\n${body}`

test('status stays silent when nothing is undecided', async () => {
  const root = await makeRoot('truss-status-od-empty-')
  try {
    await runInit(root, ['--name', 'Quiet', '--lang', 'English'])
    assert.doesNotMatch(await captureStatus(root), /Open:/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('status lists open decisions with their age', async () => {
  const root = await makeRoot('truss-status-od-')
  try {
    await runInit(root, ['--name', 'Waiting', '--lang', 'English'])
    const opened = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10)
    await fs.writeFile(path.join(root, 'state', 'open-decisions.md'), OD_FILE(
      `## OD-007 — Ship or hold?\n\nOpened: ${opened}\nOptions:\n- A: ship — now +fast / –rough\n- B: hold — later +safe / –slow\nTrade-offs: x\nLeaning: B\n`
    ))
    const out = await captureStatus(root)
    assert.match(out, /Open:/)
    assert.match(out, /OD-007 — Ship or hold\?/)
    assert.match(out, /12d/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('status marks an open decision that challenges a recorded one', async () => {
  const root = await makeRoot('truss-status-od-challenge-')
  try {
    await runInit(root, ['--name', 'Contested', '--lang', 'English'])
    await fs.writeFile(path.join(root, 'state', 'open-decisions.md'), OD_FILE(
      `## OD-007 — Revisit D-001?\n\nOpened: ${new Date().toISOString().slice(0, 10)}\nOptions:\n- A: keep — stay +cheap / –stale\n- B: move — switch +modern / –costly\nTrade-offs: x\nLeaning: A\n`
    ))
    await fs.writeFile(path.join(root, 'state', 'decisions.md'),
      `# Decisions\n\n## D-001 — Pick a stack\n\nDate: 2026-06-01\nDecision: Node.\nRationale: small runtime\nConsequences: node --test\nChallenged-by: OD-007\n`)
    assert.match(await captureStatus(root), /challenges D-001/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

// U4: absent and unreadable must not collapse into the same green output. A
// chmod'd phases.md reaches ctx.files as "not there" — without the explicit
// on-disk check, `status` would report a clean phase-less workspace over a full
// phase model, which is exactly the green-over-broken hole F-04 closed.
test('status stays silent about phases when the file is genuinely absent', async () => {
  const root = await makeRoot('truss-status-nophases-')
  try {
    await runInit(root, ['--name', 'Flat', '--lang', 'English'])
    await fs.rm(path.join(root, 'state', 'phases.md'))
    const out = await captureStatus(root)
    assert.doesNotMatch(out, /Phase:/)
    assert.doesNotMatch(out, /could not be read/)
    assert.notEqual(process.exitCode, 1, 'an absent phases.md is a supported setup, not a defect')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

// chmod 000 does not restrict root, and on Windows fs.chmod only maps the
// read-only/write attribute — it never blocks reads — so this simulated
// unreadability is meaningless (and would fail) on either.
test('status flags a present-but-unreadable phases.md instead of reporting green',
  { skip: process.getuid?.() === 0 || process.platform === 'win32' }, async () => {
  const root = await makeRoot('truss-status-unreadable-')
  try {
    await runInit(root, ['--name', 'Locked', '--lang', 'English'])
    const target = path.join(root, 'state', 'phases.md')
    await fs.chmod(target, 0o000)
    try {
      const out = await captureStatus(root)
      assert.doesNotMatch(out, /Phase:/)
      assert.match(out, /state\/phases\.md exists but could not be read/)
      // Same contract as F-04: visible note AND a non-zero exit, so a CI step
      // that only runs `status` cannot pass over it.
      assert.equal(process.exitCode, 1)
      process.exitCode = 0
    } finally { await fs.chmod(target, 0o644) }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

// ── Health is measured, not remembered (TF-001) ─────────────────────────────
// `status` read .truss/out/doctor.json: gitignored, undated on screen. On a
// fresh clone the canonical session-start command reported "Health: unknown"
// forever, and where a report did exist it could contradict a doctor run from a
// minute earlier with nothing saying so.
test('status reports health without any doctor.json present', async () => {
  const root = await makeRoot('truss-status-health-fresh-')
  try {
    await runInit(root, ['--name', 'Fresh', '--lang', 'English'])
    await fs.rm(path.join(root, '.truss', 'out'), { recursive: true, force: true })
    const out = await captureStatus(root)
    assert.doesNotMatch(out, /Health:\s+unknown/, 'no cache, but health is still known')
    assert.match(out, /Health:\s+(All checks passed|\d+ (errors|warnings))/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('status ignores a stale doctor.json and measures the current state', async () => {
  const root = await makeRoot('truss-status-health-stale-')
  try {
    await runInit(root, ['--name', 'Stale', '--lang', 'English'])
    // A report claiming disaster, from a run that no longer describes anything.
    await fs.mkdir(path.join(root, '.truss', 'out'), { recursive: true })
    await fs.writeFile(path.join(root, '.truss', 'out', 'doctor.json'), JSON.stringify({
      initialized: true, summary: { errors: 99, warnings: 99, infos: 0 }, findings: [],
    }))
    const out = await captureStatus(root)
    assert.doesNotMatch(out, /99/, 'the stale cache must not be believed')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('status sees a finding introduced after the last doctor run', async () => {
  const root = await makeRoot('truss-status-health-live-')
  try {
    await runInit(root, ['--name', 'Live', '--lang', 'English'])
    const before = await captureStatus(root)
    assert.match(before, /Health:\s+All checks passed/)
    // Break something a check will see: remove a required key from current.md.
    await fs.writeFile(path.join(root, 'state', 'current.md'), '# Current\n\nfocus: only this\n')
    const after = await captureStatus(root)
    assert.match(after, /Health:\s+\d+ warnings/)
    assert.match(after, /truss doctor` for detail/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

// ── Open human todos on the session-start screen (TF-003) ───────────────────
// HUMAN-TODOS.md was read by nothing: no boot step, no status block, no check.
// An entry written in one session came back into view only if somebody opened
// the file, which nothing prompted.
test('status lists open HT entries and hides the checked-off ones', async () => {
  const root = await makeRoot('truss-status-ht-')
  try {
    await runInit(root, ['--name', 'Todos', '--lang', 'English'])
    await fs.writeFile(path.join(root, 'HUMAN-TODOS.md'),
      '# Human ToDos\n\n'
      + '- [ ] HT-001 — grant the deploy key\n'
      + '- [x] HT-002 — already done, must not show\n'
      + '- [ ] HT-003 — sign the contract\n')
    const out = await captureStatus(root)
    assert.match(out, /ToDo:/)
    assert.match(out, /HT-001 — grant the deploy key/)
    assert.match(out, /HT-003 — sign the contract/)
    assert.doesNotMatch(out, /HT-002/, 'checked-off entries are not open work')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('status stays silent when nothing is on the human`s desk', async () => {
  const root = await makeRoot('truss-status-ht-empty-')
  try {
    await runInit(root, ['--name', 'Quiet', '--lang', 'English'])
    assert.doesNotMatch(await captureStatus(root), /ToDo:/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

// The number beside an HT entry is DERIVED, not a field: adding `Opened:` to the
// class would move the file grammar for something git already knows. It is
// labelled `idle` because blame reports the last commit that TOUCHED the line —
// re-word an entry and its clock restarts — while the OD block right below it
// prints a real age from `Opened:`.
test('status shows how long an HT entry has sat untouched, longest first', async () => {
  const root = await makeRoot('truss-status-ht-idle-')
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
  // helpers.mjs disables git reads suite-wide so the checks stay hermetic; this
  // test is specifically about the one status block that reads git.
  const priorNoGit = process.env.TRUSS_NO_GIT
  delete process.env.TRUSS_NO_GIT
  try {
    await runInit(root, ['--name', 'Idle', '--lang', 'English'])
    git('init', '-q')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 'T')

    const iso = (daysAgo) =>
      new Date(Date.now() - daysAgo * 86_400_000).toISOString()

    // Two commits, two author dates: the old entry must outrank the fresh one.
    await fs.writeFile(path.join(root, 'HUMAN-TODOS.md'),
      '# Human ToDos\n\n- [ ] HT-001 — the forgotten one\n')
    git('add', 'HUMAN-TODOS.md')
    git('commit', '-q', '--date', iso(40), '-m', 'ht: first')

    await fs.appendFile(path.join(root, 'HUMAN-TODOS.md'),
      '- [ ] HT-002 — written just now\n')
    git('add', 'HUMAN-TODOS.md')
    git('commit', '-q', '--date', iso(1), '-m', 'ht: second')

    const out = await captureStatus(root)
    assert.match(out, /HT-001 — the forgotten one {2}\(idle 40d\)/)
    assert.match(out, /HT-002 — written just now {2}\(idle 1d\)/)
    assert.ok(
      out.indexOf('HT-001') < out.indexOf('HT-002'),
      'the entry nobody has touched must not be the one the cap drops',
    )
  } finally {
    if (priorNoGit !== undefined) process.env.TRUSS_NO_GIT = priorNoGit
    await fs.rm(root, { recursive: true, force: true })
  }
})

// No git, no ages — and above all no crash and no block missing. A workspace
// that is not a checkout is a supported configuration, not a degraded one.
test('the ToDo block works without a git checkout, just without idle times', async () => {
  const root = await makeRoot('truss-status-ht-nogit-')
  try {
    await runInit(root, ['--name', 'No git', '--lang', 'English'])
    await fs.writeFile(path.join(root, 'HUMAN-TODOS.md'),
      '# Human ToDos\n\n- [ ] HT-001 — still listed\n')
    const out = await captureStatus(root)
    assert.match(out, /HT-001 — still listed/)
    assert.doesNotMatch(out, /idle/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('status caps the ToDo block and counts the rest', async () => {
  const root = await makeRoot('truss-status-ht-many-')
  try {
    await runInit(root, ['--name', 'Many', '--lang', 'English'])
    const lines = Array.from({ length: 8 }, (_, i) =>
      `- [ ] HT-${String(i + 1).padStart(3, '0')} — thing ${i + 1}`).join('\n')
    await fs.writeFile(path.join(root, 'HUMAN-TODOS.md'), `# Human ToDos\n\n${lines}\n`)
    const out = await captureStatus(root)
    assert.match(out, /… and 3 more in HUMAN-TODOS\.md/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('the ToDo block skips fenced examples, like SY-07 does', async () => {
  const root = await makeRoot('truss-status-ht-fenced-')
  try {
    await runInit(root, ['--name', 'Fenced', '--lang', 'English'])
    await fs.writeFile(path.join(root, 'HUMAN-TODOS.md'),
      '# Human ToDos\n\nWrite entries like this:\n\n```markdown\n- [ ] HT-999 — an example, not work\n```\n\n- [ ] HT-001 — real work\n')
    const out = await captureStatus(root)
    assert.match(out, /HT-001 — real work/)
    assert.doesNotMatch(out, /HT-999/, 'a documented example is not an open todo')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

// An entry carries an indented body — numbered steps and two labels
// (docs/conventions.md). A step written as a checkbox is detail INSIDE one todo;
// listing it would grow the human's queue with the very detail that makes the
// entry executable, which is this block's point inverted.
test('the ToDo block lists the entry, not the checkboxes in its body', async () => {
  const root = await makeRoot('truss-status-ht-body-')
  try {
    await runInit(root, ['--name', 'Body', '--lang', 'English'])
    await fs.writeFile(path.join(root, 'HUMAN-TODOS.md'),
      '# Human ToDos\n\n'
      + '- [ ] HT-001 — **rotate the deploy key**\n\n'
      + '  1. open the console\n'
      + '  - [ ] a step someone wrote as a checkbox\n\n'
      + '  **Done when:** the new key is live\n')
    const out = await captureStatus(root)
    // Bold in the file, plain on the screen — the markers are not content.
    assert.match(out, /HT-001 — rotate the deploy key/)
    assert.doesNotMatch(out, /\*\*/)
    assert.doesNotMatch(out, /a step someone wrote as a checkbox/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('status keeps its exit code contract — findings do not make it fail', async () => {
  const root = await makeRoot('truss-status-exit-')
  const prev = process.exitCode
  try {
    await runInit(root, ['--name', 'Exit', '--lang', 'English'])
    process.exitCode = undefined
    await fs.writeFile(path.join(root, 'state', 'current.md'), '# Current\n\nfocus: only this\n')
    await captureStatus(root)
    assert.ok(!process.exitCode, 'doctor is the gate; status is the briefing')
  } finally {
    process.exitCode = prev
    await fs.rm(root, { recursive: true, force: true })
  }
})
