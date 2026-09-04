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
