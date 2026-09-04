// .truss/tests/doctor-json.test.mjs — doctor --json carries initialized:true
// Regression for the dashboard "Workspace not initialised" bug: a stale
// doctor.json (initialized:false, written by a pre-init `doctor --json`) must be
// healed by the next doctor run on an initialised workspace.
// Run with: node --test .truss/tests/doctor-json.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { runInit } from '../lib/commands/init.mjs'
import { makeRoot, read } from './helpers.mjs'

const execFileP = promisify(execFile)
const binOf = (root) => path.join(root, '.truss', 'bin', 'truss.mjs')

describe('doctor --json initialized flag', () => {
  it('uninit folder → report has initialized:false', async () => {
    const root = await makeRoot('truss-docjson-uninit-')
    await execFileP('node', [binOf(root), 'doctor', '--json'], { cwd: root, env: { ...process.env, TRUSS_NO_GIT: '1' } })
    const j = JSON.parse(await read(root, '.truss/out/doctor.json'))
    assert.equal(j.initialized, false)
  })

  it('after init, doctor --json self-heals a stale initialized:false', async () => {
    const root = await makeRoot('truss-docjson-heal-')
    // 1. stale pre-init report
    await execFileP('node', [binOf(root), 'doctor', '--json'], { cwd: root, env: { ...process.env, TRUSS_NO_GIT: '1' } })
    assert.equal(JSON.parse(await read(root, '.truss/out/doctor.json')).initialized, false)
    // 2. init, then re-run doctor
    await runInit(root, ['--name', 'Demo', '--lang', 'English'])
    await execFileP('node', [binOf(root), 'doctor', '--json'], { cwd: root, env: { ...process.env, TRUSS_NO_GIT: '1' } })
    const healed = JSON.parse(await read(root, '.truss/out/doctor.json'))
    assert.equal(healed.initialized, true)
    assert.ok(healed.summary, 'normal report keeps its summary')
  })
})

// ── `--json` is for tooling, so it has to reach stdout ──────────────────────
// It used to write .truss/out/doctor.json and print only a note to stderr, so
// the obvious use of the flag — `doctor --json | jq .findings` — returned
// nothing, from a gitignored path at that.
describe('doctor --json writes to stdout', () => {
  it('stdout carries the full report, and the file still gets written', async () => {
    const root = await makeRoot('truss-docjson-stdout-')
    await runInit(root, ['--name', 'Piped', '--lang', 'English'])
    const { stdout } = await execFileP('node', [binOf(root), 'doctor', '--json'],
      { cwd: root, env: { ...process.env, TRUSS_NO_GIT: '1' } })

    const piped = JSON.parse(stdout)
    assert.equal(piped.initialized, true)
    assert.ok(Array.isArray(piped.findings), 'findings are pipeable')
    assert.ok(Array.isArray(piped.checks) && piped.checks.length > 0, 'the check catalog is pipeable')

    const onDisk = JSON.parse(await read(root, '.truss/out/doctor.json'))
    assert.deepEqual(piped.findings, onDisk.findings, 'stdout and file agree')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('an uninitialised folder also reports on stdout', async () => {
    const root = await makeRoot('truss-docjson-stdout-uninit-')
    const { stdout } = await execFileP('node', [binOf(root), 'doctor', '--json'],
      { cwd: root, env: { ...process.env, TRUSS_NO_GIT: '1' } })
    assert.equal(JSON.parse(stdout).initialized, false)
    await fs.rm(root, { recursive: true, force: true })
  })
})
