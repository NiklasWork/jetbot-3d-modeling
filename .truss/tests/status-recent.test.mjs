// .truss/tests/status-recent.test.mjs — `truss status` "Recent:" commits section (U6/D-074)
// Run with: node --test .truss/tests/status-recent.test.mjs
//
// NOTE: this file does NOT import ./helpers.mjs — helpers sets TRUSS_NO_GIT=1,
// which would disable the very git reads under test here (same reasoning as
// tests/git.test.mjs). node's test runner isolates each file in its own
// process, so the clean env stays local to this file.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { runInit } from '../lib/commands/init.mjs'
import { runStatus } from '../lib/commands/status.mjs'

const execFileP = promisify(execFile)

// This file lives at <repo>/.truss/tests/status-recent.test.mjs → ENGINE_DIR = <repo>/.truss
const ENGINE_DIR = path.join(fileURLToPath(import.meta.url), '..', '..')

async function copyEngine(root) {
  const dest = path.join(root, '.truss')
  for (const sub of ['bin', 'lib', 'checks', 'prefs', 'prompts', 'baseline']) {
    await fs.cp(path.join(ENGINE_DIR, sub), path.join(dest, sub), { recursive: true })
  }
  try { await fs.cp(path.join(ENGINE_DIR, 'VERSION'), path.join(dest, 'VERSION')) } catch {}
}

async function makeRoot(tag) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), tag))
  await copyEngine(root)
  return root
}

const git = (root, ...args) => execFileP('git', ['-C', root, ...args])

const captureStatus = async (root) => {
  const output = []
  const originalLog = console.log
  try {
    console.log = (...args) => output.push(args.join(' '))
    await runStatus(root, [])
  } finally { console.log = originalLog }
  return output.join('\n')
}

describe('truss status — Recent commits (U6/D-074, replaces recently-done:)', () => {
  it('a fresh `init` already leaves a git repo (the wrapper gets `git init`), and status shows commits once one exists', async () => {
    const root = await makeRoot('truss-status-recent-init-')
    try {
      await runInit(root, ['--name', 'Recent', '--lang', 'English'])
      assert.ok(await fs.stat(path.join(root, '.git')).then(() => true, () => false), '`init` should run `git init`')
      await git(root, 'config', 'user.email', 't@t')
      await git(root, 'config', 'user.name', 'T')
      await git(root, 'add', '-A')
      await git(root, 'commit', '-q', '-m', 'chore: initial scaffold')
      const out = await captureStatus(root)
      assert.match(out, /Recent:/)
      assert.match(out, /chore: initial scaffold/)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('lists newest first and caps at 5', async () => {
    const root = await makeRoot('truss-status-recent-cap-')
    try {
      await runInit(root, ['--name', 'Cap', '--lang', 'English'])
      await git(root, 'config', 'user.email', 't@t')
      await git(root, 'config', 'user.name', 'T')
      for (let i = 0; i < 7; i++) {
        await fs.writeFile(path.join(root, `note-${i}.md`), `# ${i}\n`)
        await git(root, 'add', '-A')
        await git(root, 'commit', '-q', '-m', `note ${i}`)
      }
      const out = await captureStatus(root)
      const noteLines = out.split('\n').filter(l => /note \d/.test(l))
      assert.equal(noteLines.length, 5, out)
      assert.match(out, /note 6\b/)   // newest kept
      assert.doesNotMatch(out, /note 1\b/) // oldest of the 7 dropped
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('stays silent, exit unchanged, when the workspace has no git repo', async () => {
    const root = await makeRoot('truss-status-recent-nogit-')
    try {
      await runInit(root, ['--name', 'NoGit', '--lang', 'English'])
      await fs.rm(path.join(root, '.git'), { recursive: true, force: true })
      const priorExit = process.exitCode
      const out = await captureStatus(root)
      assert.doesNotMatch(out, /Recent:/)
      assert.equal(process.exitCode, priorExit)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('stays silent on a git repo with zero commits yet', async () => {
    const root = await makeRoot('truss-status-recent-zero-')
    try {
      await runInit(root, ['--name', 'Zero', '--lang', 'English']) // git init only, no commit
      const out = await captureStatus(root)
      assert.doesNotMatch(out, /Recent:/)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  it('stays silent under TRUSS_NO_GIT, exit unchanged', async () => {
    const root = await makeRoot('truss-status-recent-disabled-')
    try {
      await runInit(root, ['--name', 'Disabled', '--lang', 'English'])
      await git(root, 'config', 'user.email', 't@t')
      await git(root, 'config', 'user.name', 'T')
      await git(root, 'add', '-A')
      await git(root, 'commit', '-q', '-m', 'chore: initial scaffold')
      process.env.TRUSS_NO_GIT = '1'
      const priorExit = process.exitCode
      const out = await captureStatus(root)
      delete process.env.TRUSS_NO_GIT
      assert.doesNotMatch(out, /Recent:/)
      assert.equal(process.exitCode, priorExit)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})
