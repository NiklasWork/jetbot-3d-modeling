// .truss/tests/git.test.mjs — lib/git.mjs (overlay branch helpers)
// Run with: node --test .truss/tests/git.test.mjs
//
// NOTE: this file does NOT import ./helpers.mjs — helpers sets TRUSS_NO_GIT=1,
// which would disable the very git reads we are testing here. node's test runner
// isolates each file in its own process, so the clean env stays local.
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { repoBranchInfo, repoBranchList, declaredBranch, branchReport, isGitCheckout, recentCommits } from '../lib/git.mjs'

const execFileP = promisify(execFile)

let root, repoDir
const git = (...args) => execFileP('git', ['-C', repoDir, ...args])

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-git-'))
  repoDir = path.join(root, 'repo')
  await fs.mkdir(repoDir)
  await git('init', '-q')
  await git('config', 'user.email', 't@t')
  await git('config', 'user.name', 'T')
  await git('commit', '-q', '--allow-empty', '-m', 'init')
  await git('checkout', '-q', '-b', 'feature/auth')
  await fs.mkdir(path.join(root, 'state'), { recursive: true })
})

after(async () => { await fs.rm(root, { recursive: true, force: true }) })

const writeCurrent = (branch) =>
  fs.writeFile(path.join(root, 'state', 'current.md'),
    `# Current\n\nfocus:\n\nbranch: ${branch}\n\nnext:\n`, 'utf8')

describe('lib/git.mjs', () => {
  it('isGitCheckout true for repo/, false elsewhere', async () => {
    assert.equal(await isGitCheckout(repoDir), true)
    assert.equal(await isGitCheckout(path.join(root, 'nope')), false)
  })

  it('repoBranchInfo reports the current branch', async () => {
    const info = await repoBranchInfo(repoDir)
    assert.equal(info.ok, true)
    assert.equal(info.branch, 'feature/auth')
    assert.equal(info.detached, false)
  })

  it('repoBranchInfo handles detached HEAD', async () => {
    await git('checkout', '-q', 'HEAD~0', '--detach')
    const info = await repoBranchInfo(repoDir)
    assert.equal(info.ok, true)
    assert.equal(info.detached, true)
    assert.equal(info.branch, null)
    assert.match(info.sha, /^[0-9a-f]{7,}$/)
    await git('checkout', '-q', 'feature/auth')
  })

  it('repoBranchInfo skips cleanly when not a checkout / disabled', async () => {
    assert.equal((await repoBranchInfo(path.join(root, 'nope'))).reason, 'not-a-checkout')
    process.env.TRUSS_NO_GIT = '1'
    assert.equal((await repoBranchInfo(repoDir)).reason, 'disabled')
    delete process.env.TRUSS_NO_GIT
  })

  it('repoBranchList includes the local branches', async () => {
    const list = await repoBranchList(repoDir)
    assert.ok(list.includes('feature/auth'))
  })

  it('declaredBranch reads current.md branch:', async () => {
    await writeCurrent('feature/auth')
    assert.equal(await declaredBranch(root), 'feature/auth')
  })

  it('branchReport: match when declared == checkout', async () => {
    await writeCurrent('feature/auth')
    const r = await branchReport(root)
    assert.equal(r.present, true)
    assert.equal(r.match, true)
    assert.equal(r.mismatch, false)
  })

  it('branchReport: mismatch when declared != checkout', async () => {
    await writeCurrent('main')
    const r = await branchReport(root)
    assert.equal(r.match, false)
    assert.equal(r.mismatch, true)
  })

  it('branchReport: present=false under TRUSS_NO_GIT (no UI)', async () => {
    process.env.TRUSS_NO_GIT = '1'
    const r = await branchReport(root)
    delete process.env.TRUSS_NO_GIT
    assert.equal(r.present, false)
    assert.equal(r.mismatch, false)
  })

  it('branchReport: no current.md → declared null, no mismatch, no throw', async () => {
    await fs.rm(path.join(root, 'state', 'current.md'), { force: true })
    const r = await branchReport(root)
    assert.equal(r.declared, null)
    assert.equal(r.mismatch, false)
    assert.equal(r.present, true) // checkout still present
  })

  it('declaredBranch: blank branch: line → null', async () => {
    await fs.writeFile(path.join(root, 'state', 'current.md'), 'focus:\n\nbranch:   \n', 'utf8')
    assert.equal(await declaredBranch(root), null)
  })

  it('recentCommits: newest first, short sha + subject (U6/D-074)', async () => {
    await git('commit', '-q', '--allow-empty', '-m', 'second commit')
    const { ok, commits } = await recentCommits(repoDir, 5)
    assert.equal(ok, true)
    assert.equal(commits[0].subject, 'second commit')
    assert.equal(commits[1].subject, 'init')
    assert.match(commits[0].sha, /^[0-9a-f]{7,}$/)
  })

  it('recentCommits: respects the limit', async () => {
    const { commits } = await recentCommits(repoDir, 1)
    assert.equal(commits.length, 1)
    assert.equal(commits[0].subject, 'second commit')
  })

  it('recentCommits: not-a-checkout, disabled, and no-git-binary all resolve quietly', async () => {
    assert.equal((await recentCommits(path.join(root, 'nope'))).reason, 'not-a-checkout')
    process.env.TRUSS_NO_GIT = '1'
    const disabled = await recentCommits(repoDir)
    delete process.env.TRUSS_NO_GIT
    assert.equal(disabled.ok, false)
    assert.equal(disabled.reason, 'disabled')
    assert.deepEqual(disabled.commits, [])
  })

  it('recentCommits: an empty repo (git init, no commits yet) resolves quietly, never throws', async () => {
    const empty = path.join(root, 'empty-repo')
    await fs.mkdir(empty)
    await execFileP('git', ['-C', empty, 'init', '-q'])
    const r = await recentCommits(empty)
    assert.equal(r.ok, false)
    assert.deepEqual(r.commits, [])
  })

  it('branchReport follows a custom code-root from profile.md', async () => {
    const customRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'truss-git-custom-'))
    const product = path.join(customRoot, 'product')
    try {
      await fs.mkdir(path.join(customRoot, 'state'), { recursive: true })
      await fs.mkdir(product)
      await execFileP('git', ['-C', product, 'init', '-q'])
      await execFileP('git', ['-C', product, 'config', 'user.email', 't@t'])
      await execFileP('git', ['-C', product, 'config', 'user.name', 'T'])
      await execFileP('git', ['-C', product, 'commit', '-q', '--allow-empty', '-m', 'init'])
      const { stdout } = await execFileP(
        'git',
        ['-C', product, 'symbolic-ref', '--short', 'HEAD'],
      )
      const branch = stdout.trim()
      await fs.writeFile(
        path.join(customRoot, 'state', 'profile.md'),
        '## Project\n\ncode-root: product\n',
      )
      await fs.writeFile(
        path.join(customRoot, 'state', 'current.md'),
        `focus:\n\nbranch: ${branch}\n`,
      )

      const report = await branchReport(customRoot)
      assert.equal(report.codeRoot, 'product')
      assert.equal(report.present, true)
      assert.equal(report.match, true)
    } finally {
      await fs.rm(customRoot, { recursive: true, force: true })
    }
  })
})
