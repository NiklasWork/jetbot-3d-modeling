// lib/git.mjs — read-only git helpers for the configured code root, and for
// the workspace's own repo (recentCommits).
//
// The doctor checks stay pure file reads by design (see checks/sy.mjs). The
// branch awareness for a code root lives OUTSIDE the check engine — in `truss
// status` — and that is what this module powers. It only ever
// READS git state (never mutates), shells out with execFile (no shell), short
// timeouts, and degrades gracefully so a missing git binary or a non-overlay
// workspace without a code root is a quiet skip, never an error.
//
// recentCommits reads the WORKSPACE repo, not the code root (U6/D-074: `git
// log` replaces the hand-maintained `recently-done:` list in current.md — see
// checks/sy.mjs and lib/commands/status.mjs). Same never-throws contract.
//
// The configured directory may be a clone, a symlink, or a tracked submodule.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveCodeRoot } from './code-root.mjs'

const execFileP = promisify(execFile)

/** Is there a git checkout at `repoDir`? Pure fs read (follows the symlink). */
export async function isGitCheckout(repoDir) {
  try { await fs.access(path.join(repoDir, '.git')); return true } catch { return false }
}

/**
 * The branch info for a checkout. Never throws.
 * @returns {Promise<{ok:boolean, branch:string|null, detached:boolean, sha:string|null, reason:string|null}>}
 *   reason ∈ disabled | not-a-checkout | no-git-binary | error  (only when ok=false)
 */
export async function repoBranchInfo(repoDir) {
  const off = (reason) => ({ ok: false, branch: null, detached: false, sha: null, reason })
  if (process.env.TRUSS_NO_GIT) return off('disabled')
  if (!await isGitCheckout(repoDir)) return off('not-a-checkout')
  const run = (args) => execFileP('git', ['-C', repoDir, ...args], { timeout: 5000, maxBuffer: 1 << 20 })
  try {
    // --quiet → exit 1 (no throw text) on detached HEAD; we catch and fall back.
    const { stdout } = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'])
    const branch = stdout.trim()
    if (branch) return { ok: true, branch, detached: false, sha: null, reason: null }
  } catch (err) {
    if (err?.code === 'ENOENT') return off('no-git-binary')
    // non-zero exit (detached HEAD) → fall through to read the sha
  }
  try {
    const { stdout } = await run(['rev-parse', '--short', 'HEAD'])
    return { ok: true, branch: null, detached: true, sha: stdout.trim() || null, reason: null }
  } catch (err) {
    if (err?.code === 'ENOENT') return off('no-git-binary')
    return off('error')
  }
}

/**
 * The last `limit` commits at `repoDir`, newest first — short sha + one-line
 * subject. Never throws: no checkout, an empty repo (no commits yet), a
 * disabled read (TRUSS_NO_GIT), or a missing git binary all resolve to
 * `ok: false` so the caller (truss status) can skip the section in silence.
 * @returns {Promise<{ok:boolean, commits:Array<{sha:string, subject:string}>, reason:string|null}>}
 */
export async function recentCommits(repoDir, limit = 5) {
  const off = (reason) => ({ ok: false, commits: [], reason })
  if (process.env.TRUSS_NO_GIT) return off('disabled')
  if (!await isGitCheckout(repoDir)) return off('not-a-checkout')
  try {
    const { stdout } = await execFileP(
      'git', ['-C', repoDir, 'log', '-n', String(limit), '--pretty=format:%h %s'],
      { timeout: 5000, maxBuffer: 1 << 20 },
    )
    const commits = stdout.split('\n').filter(Boolean).map(line => {
      const sp = line.indexOf(' ')
      return sp === -1 ? { sha: line, subject: '' } : { sha: line.slice(0, sp), subject: line.slice(sp + 1) }
    })
    return { ok: true, commits, reason: null }
  } catch (err) {
    if (err?.code === 'ENOENT') return off('no-git-binary')
    // Also covers the empty-repo case: `git log` errors out with no commits yet.
    return off('error')
  }
}

/** Local branch names at `repoDir`, current first-class via repoBranchInfo. Never throws. */
export async function repoBranchList(repoDir) {
  if (process.env.TRUSS_NO_GIT) return []
  if (!await isGitCheckout(repoDir)) return []
  try {
    const { stdout } = await execFileP(
      'git', ['-C', repoDir, 'branch', '--format=%(refname:short)'],
      { timeout: 5000, maxBuffer: 1 << 20 }
    )
    return stdout.split('\n').map(s => s.trim()).filter(Boolean)
  } catch { return [] }
}

/**
 * How long each line of `relPath` has been sitting unchanged, from `git blame`.
 *
 * WHY THIS AND NOT A DATE FIELD. A HUMAN-TODOS.md entry is anchored by one
 * parsed line (`- [ ] HT-NNN — …`), and nothing measured how long one had been
 * waiting: an external report found a median of ≥38 days with no check able to
 * see it. The obvious fix — add an `Opened:` field to the class — makes the
 * lightest entry class heavier and moves the file grammar for a number git
 * already knows. So this derives it instead, in ONE `git blame` call for the
 * whole file; the caller blames the entry line, so rewriting a step in the
 * indented body below it does not reset the number.
 *
 * WHAT IT ACTUALLY MEASURES — and the reason callers must not call it "age":
 * blame reports the last commit that TOUCHED a line, not the one that added it.
 * Re-word an entry and its clock restarts. The honest reading is "unchanged
 * since", which is what the caller labels it (`idle Nd`); a caller that prints
 * it as a creation date would be stating something this data cannot support.
 *
 * Never throws — no checkout, no git binary, an untracked file, or a disabled
 * read (TRUSS_NO_GIT) all resolve to an empty map, and the caller simply prints
 * no ages. Uncommitted lines blame to the zero sha with the current time, so a
 * just-written entry correctly shows as fresh.
 *
 * @returns {Promise<Map<number, number>>} 1-based line number → author time (ms)
 */
export async function fileLineAges(repoDir, relPath) {
  if (process.env.TRUSS_NO_GIT) return new Map()
  if (!await isGitCheckout(repoDir)) return new Map()
  try {
    const { stdout } = await execFileP(
      'git', ['-C', repoDir, 'blame', '--line-porcelain', '--', relPath],
      { timeout: 5000, maxBuffer: 8 << 20 },
    )
    const ages = new Map()
    // Porcelain groups: a header line "<sha> <origLine> <finalLine> [count]"
    // opens each entry, and `author-time <epoch>` follows within it.
    let line = null
    for (const raw of stdout.split('\n')) {
      // `\^?`: git marks a BOUNDARY commit by prefixing its sha with a caret.
      // Without this the header simply would not match and those lines would
      // quietly have no age — a partial failure that looks like success from the
      // inside (`L-011`), and it is the shallow-clone/limited-range case, not an
      // exotic one. Content lines are TAB-prefixed, so they can never match here.
      const header = raw.match(/^\^?[0-9a-f]{7,40}\s+\d+\s+(\d+)(?:\s+\d+)?$/)
      if (header) { line = Number(header[1]); continue }
      const at = raw.match(/^author-time (\d+)$/)
      if (at && line != null) { ages.set(line, Number(at[1]) * 1000); line = null }
    }
    return ages
  } catch { return new Map() }
}

/**
 * Return uncommitted paths in a git checkout. Paths include staged, unstaged,
 * untracked, deleted, and both sides of renames. Never throws.
 */
export async function gitChangedPaths(repoDir) {
  const off = (reason) => ({ ok: false, paths: [], reason })
  if (process.env.TRUSS_NO_GIT) return off('disabled')
  if (!await isGitCheckout(repoDir)) return off('not-a-checkout')

  try {
    const { stdout } = await execFileP(
      'git',
      ['-C', repoDir, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { timeout: 5000, maxBuffer: 4 << 20 }
    )
    const records = stdout.split('\0')
    const paths = []
    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      if (!record || record.length < 4) continue
      const status = record.slice(0, 2)
      paths.push(record.slice(3).replace(/\\/g, '/'))
      if (/[RC]/.test(status)) {
        const otherPath = records[++i]
        if (otherPath) paths.push(otherPath.replace(/\\/g, '/'))
      }
    }
    return { ok: true, paths: [...new Set(paths)], reason: null }
  } catch (err) {
    if (err?.code === 'ENOENT') return off('no-git-binary')
    return off('error')
  }
}

/** The `branch:` value declared in state/current.md (the expected branch), or null. */
export async function declaredBranch(root) {
  try {
    const raw = await fs.readFile(path.join(root, 'state', 'current.md'), 'utf8')
    const line = raw.split('\n').find(l => l.toLowerCase().startsWith('branch:'))
    if (!line) return null
    const v = line.slice(line.indexOf(':') + 1).trim()
    return v || null
  } catch { return null }
}

/**
 * Compare the configured code root's checked-out branch against `branch:`.
 * The single source of truth for the status branch line. Never throws.
 * @returns {Promise<{
 *   present:boolean, info:object, declared:string|null,
 *   match:boolean, mismatch:boolean
 * }>}  present=false when there is no overlay checkout, or git reads are disabled
 *      (TRUSS_NO_GIT) — both mean "show no branch UI". present=true when a
 *      checkout exists, even if currently unreadable (git missing) — so the UI
 *      can surface that state.
 */
export async function branchReport(root) {
  const codeRoot = await resolveCodeRoot(root)
  if (!codeRoot.rel || codeRoot.error) {
    return {
      present: false,
      info: { ok: false, branch: null, detached: false, sha: null, reason: 'no-code-root' },
      declared: await declaredBranch(root),
      match: false,
      mismatch: false,
      codeRoot: codeRoot.rel,
    }
  }
  const info = await repoBranchInfo(codeRoot.abs)
  const declared = await declaredBranch(root)
  const present = info.ok || (info.reason !== 'not-a-checkout' && info.reason !== 'disabled')
  const onBranch = info.ok && !info.detached && info.branch
  const match = !!(onBranch && declared && info.branch === declared)
  const mismatch = !!(declared && ((onBranch && info.branch !== declared) || info.detached))
  return { present, info, declared, match, mismatch, codeRoot: codeRoot.rel }
}
