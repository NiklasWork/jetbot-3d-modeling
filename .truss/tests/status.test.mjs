import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

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
