// lib/commands/upgrade.mjs — `truss upgrade` (D-034, closes OD-006).
//
// Lifts an existing workspace to this engine's version. Two halves, split at the
// seam where a script stops being able to decide:
//
//   mechanical  — swap .truss/ (preserving prompts/custom/), then reconcile the
//                 baseline-derived workspace files by 3-way merge. Done here.
//   judgment    — the hunks where the project and the baseline changed the same
//                 place. Handed to the agent as an inline prompt in the upgrade output.
//
// THE MERGE BASE IS FREE. Every installed engine carries .truss/baseline/ — the
// exact files the workspace was scaffolded from, at the installed version. So:
//
//   base   = <backup>/baseline/<f>   (the old engine, moved aside, still on disk)
//   theirs = <new>/.truss/baseline/<f>
//   mine   = <workspace>/<f>
//
// No manifest, no checksums, no network, no version matrix to maintain. The one
// rule this depends on: read the old baseline BEFORE the swap — hence the backup
// is a rename, never a delete.
//
// DIRECTION OF INVOCATION (the property that keeps this stable across versions):
// the NEW engine upgrades the OLD workspace, never the reverse —
//
//   git clone --depth 1 https://github.com/KornLabs/truss.git /tmp/truss
//   node /tmp/truss/.truss/bin/truss.mjs upgrade        # run from the workspace
//
// An instance on any past version can therefore be lifted by any future engine,
// because the upgrade code is always the newer one. A version-specific fixup
// (a renamed key, a moved file) belongs in THIS file, keyed on fromVersion —
// executable and testable, rather than prose in a migration doc the adopter has
// to apply by hand. RETIRED_KEYS in lib/prefs.mjs already covers that class for
// preferences; nothing else has needed one yet.
//
// SEED vs. SCAFFOLD — the distinction the first cut of this command got wrong.
// `baseline/` holds two kinds of file and only one of them may ever be written
// here. `AGENTS.md`, `docs/*`, `package.json`, the ignore files and the adapter
// stubs are FRAMEWORK: the project edits them, but their content is Truss's, so
// a new version has something to say about them. `state/*`, `VISION.md` and
// `README.md` are SEED: init writes them once and from that moment they are pure
// project matter — a decision log, a phase plan, a vision. Line-merging a new
// template into those destroys project content (and would let a template diff
// rewrite state/decisions.md, which AGENTS.md §5 forbids outright). Seed files
// are therefore never written, only reported when the baseline moved under them.
//
// Write discipline: workspace files are written atomically (lib/scaffold.mjs),
// only when the outcome is unambiguous, and never through a symlink. Upstream-
// unchanged, seed and locally-deleted files are left alone; a conflicted merge
// lands in <file>.truss-merge with the original untouched. The engine is staged
// into .truss.incoming/ and swapped by two renames, so an interrupted copy
// leaves the workspace exactly as it was. A workspace is bootable at every point
// of the run, and an interrupted run never reports itself as a finished one.

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseBlocks } from '../md.mjs'
import { writeFileAtomic } from '../scaffold.mjs'
import { isGitCheckout } from '../git.mjs'
import { buildExcludes, discoverGroups, readSelectedGroups } from '../skill-groups.mjs'
import { verifyEngine } from '../engine-manifest.mjs'

const execFileP = promisify(execFile)

/** A fatal, user-facing upgrade error (mapped to exit code 2 by the dispatcher). */
export class UpgradeError extends Error {}

/** Exit code when the run finished but left work that needs a human or an agent. */
const EXIT_NEEDS_ATTENTION = 3

/** Staging directory for the incoming engine; swapped in by rename. */
const INCOMING = '.truss.incoming'

// Baseline paths that init writes once and the project owns from then on. Never
// written by an upgrade — see the SEED vs. SCAFFOLD note in the file header.
const SEED_ONLY = ['state/', 'VISION.md', 'README.md']

// Baseline paths that are init inputs, not workspace files (overlay/phases.md is
// a phase source init picks between; it never lands at that path in a workspace).
const NOT_SCAFFOLDED = ['overlay/']

const startsWithAny = (rel, prefixes) =>
  prefixes.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p))

const isExcluded = (rel, prefixes) =>
  prefixes?.has(rel) || [...(prefixes ?? [])].some(prefix => rel.startsWith(`${prefix}/`))

export const isSeedOnly = (rel) => startsWithAny(rel, SEED_ONLY)

async function readBuf(p) {
  try { return await fs.readFile(p) } catch { return null }
}

async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

/** Buffer equality that treats "both absent" as equal and "one absent" as different. */
const sameBytes = (a, b) => (a === null || b === null ? a === b : a.equals(b))

/** A NUL byte means git merge-file would refuse it and utf8 round-tripping would corrupt it. */
const isBinary = (buf) => buf !== null && buf.includes(0)

/** Parse argv into upgrade options. Supports "--flag v" and "--flag=v". */
export function parseUpgradeArgs(argv) {
  const opts = { root: null, force: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--force') opts.force = true
    else if (a === '--dry-run' || a === '-n') opts.dryRun = true
    else if (a === '--root') {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('-')) throw new UpgradeError('upgrade: --root expects a value')
      opts.root = v; i++
    }
    else if (a.startsWith('--root=')) opts.root = a.slice('--root='.length)
    else throw new UpgradeError(`upgrade: unknown argument '${a}'`)
  }
  return opts
}

// ── Generated-block alignment ────────────────────────────────────────────────
// AGENTS.md carries two machine-written blocks (preferences, phase). The
// baseline ships placeholders; every real workspace has rendered content there.
// Left alone, those regions differ on all three sides and conflict on EVERY
// upgrade — in the one file that matters most. So before merging, the block
// bodies in base and theirs are overwritten with the body the workspace already
// has: identical on all three sides, therefore invisible to the merge, and the
// workspace's rendered blocks survive verbatim. `truss set` and `truss render`
// remain the only writers of that content, exactly as AGENTS.md §5 requires.

/** A block is usable for alignment only if it is a single, properly paired region. */
function soundBlock(block) {
  return !!block?.innerLines
    && !block.duplicateBegin && !block.orphanEnd
    && Number.isInteger(block.startLine) && Number.isInteger(block.endLine)
    && block.endLine - 1 >= block.startLine
}

/** Replace each generated block body in `other` with the body from `mine`. */
export function alignGeneratedBlocks(mineText, otherText) {
  const mineBlocks = parseBlocks(mineText.split('\n'))
  if (mineBlocks.size === 0) return otherText

  const lines = otherText.split('\n')
  const otherBlocks = parseBlocks(lines)
  const targets = []
  for (const [id, mineBlock] of mineBlocks) {
    const otherBlock = otherBlocks.get(id)
    // A malformed marker pair on either side is left strictly alone: splicing
    // against a bogus range corrupts the merge input instead of aligning it.
    if (!soundBlock(mineBlock) || !soundBlock(otherBlock)) continue
    targets.push({ start: otherBlock.startLine, end: otherBlock.endLine - 1, inner: mineBlock.innerLines })
  }
  // Rewrite back-to-front so earlier block offsets stay valid.
  for (const t of targets.sort((a, b) => b.start - a.start)) {
    lines.splice(t.start, t.end - t.start, ...t.inner)
  }
  return lines.join('\n')
}

// ── Planning ─────────────────────────────────────────────────────────────────

/** Every file below `dir`, as paths relative to it (POSIX separators). */
async function walkRel(dir, rel = '') {
  let entries
  try { entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }) }
  catch { return [] }
  const out = []
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...await walkRel(dir, r))
    else if (e.isFile()) out.push(r)
  }
  return out
}

/**
 * Decide, per baseline file, what the upgrade should do — without writing
 * anything. Pure enough to drive both --dry-run and the real run.
 *
 * @returns {Promise<Array<{rel:string, action:string, note:string}>>}
 *   action ∈ write | merge | report | skip
 */
export async function planBaseline(target, baseDir, theirsDir, { exclude = null } = {}) {
  const rels = [...new Set([...await walkRel(baseDir), ...await walkRel(theirsDir)])]
    .filter((rel) => !startsWithAny(rel, NOT_SCAFFOLDED) && !isExcluded(rel, exclude))
    .sort()
  const plan = []

  for (const rel of rels) {
    const [base, theirs, mine] = await Promise.all([
      readBuf(path.join(baseDir, rel)),
      readBuf(path.join(theirsDir, rel)),
      readBuf(path.join(target, rel)),
    ])

    if (theirs === null) {
      // Dropped from the baseline (e.g. the state files that became on-demand in
      // D-028). An existing copy is the project's now — never delete it.
      if (mine !== null) plan.push({ rel, action: 'skip', note: 'no longer part of the baseline — kept as yours' })
      continue
    }
    if (sameBytes(base, theirs)) continue                           // upstream unchanged — the bulk

    if (isSeedOnly(rel)) {
      // Project matter. The baseline moved, but this file's content is not
      // Truss's to rewrite — say so and leave it entirely alone.
      plan.push({
        rel,
        action: 'report',
        note: mine === null
          ? 'seed file — the baseline changed; not created, this is yours to write'
          : 'seed file — the baseline changed; yours is untouched, compare by hand',
      })
      continue
    }

    if (mine === null) {
      // New in this version → create it. Deleted locally while the baseline
      // still had it → the deletion was deliberate; do not resurrect.
      if (base === null) plan.push({ rel, action: 'write', note: 'new in this version' })
      else plan.push({ rel, action: 'skip', note: 'not present here — upstream change not applied' })
      continue
    }
    if (sameBytes(mine, theirs)) continue                           // already matches the new baseline
    if (sameBytes(mine, base)) { plan.push({ rel, action: 'write', note: 'unmodified here — taken from the new baseline' }); continue }
    if (base === null) { plan.push({ rel, action: 'report', note: 'added on both sides — compare by hand' }); continue }
    if (isBinary(mine) || isBinary(base) || isBinary(theirs)) {
      plan.push({ rel, action: 'report', note: 'binary file changed on both sides — compare by hand' })
      continue
    }
    plan.push({ rel, action: 'merge', note: 'changed on both sides' })
  }
  return plan
}

// ── Applying ─────────────────────────────────────────────────────────────────

/**
 * 3-way merge via `git merge-file` — already a hard requirement of the install
 * (the engine arrives by `git clone`), so this costs no dependency.
 * @returns {Promise<{text:string|null, conflicts:boolean, reason:string|null}>}
 *   text=null → nothing usable came back; `reason` says why.
 */
async function mergeThreeWay(tmpDir, rel, mine, base, theirs) {
  const stem = rel.replace(/[\\/]/g, '_')
  const f = { mine: path.join(tmpDir, `${stem}.mine`), base: path.join(tmpDir, `${stem}.base`), theirs: path.join(tmpDir, `${stem}.theirs`) }
  await fs.writeFile(f.mine, mine, 'utf8')
  await fs.writeFile(f.base, base, 'utf8')
  await fs.writeFile(f.theirs, theirs, 'utf8')
  const opts = { maxBuffer: 256 << 20, timeout: 60_000 }   // never truncate a merge into a silent lie
  try {
    const { stdout } = await execFileP('git', [
      'merge-file', '-p',
      '-L', 'yours', '-L', 'baseline (old)', '-L', 'baseline (new)',
      f.mine, f.base, f.theirs,
    ], opts)
    return { text: stdout, conflicts: false, reason: null }
  } catch (err) {
    // Exit code > 0 with output means conflicts, and stdout holds the marked-up
    // merge. No output at all is a genuine failure — say which, never dress a
    // git error up as "unavailable".
    // err.signal is set when the timeout killed git: stdout may then be a
    // truncated prefix, which must never be dressed up as a conflict.
    if (typeof err.stdout === 'string' && err.stdout.length > 0
        && !err.signal && !err.code?.toString().startsWith('ERR_')) {
      return { text: err.stdout, conflicts: true, reason: null }
    }
    const reason = err.code === 'ENOENT'
      ? 'git is not installed — merge by hand'
      : `git merge-file failed (${(err.stderr || err.code || err.message || '').toString().trim().split('\n')[0]}) — merge by hand`
    return { text: null, conflicts: false, reason }
  }
}

/**
 * Write a workspace file atomically. Refuses to follow a symlink: writeFileAtomic
 * renames over the path, which replaces the link rather than writing through it,
 * so the target outside the workspace stays untouched — but a silently replaced
 * symlink is its own surprise, so the caller reports it.
 */
async function writeWorkspaceFile(target, abs, content) {
  let wasSymlink = false
  try { wasSymlink = (await fs.lstat(abs)).isSymbolicLink() } catch {}
  await assertInsideWorkspace(target, abs)
  await writeFileAtomic(abs, content)
  return wasSymlink
}

/**
 * Confine a write to the workspace. Checking the final component is not enough:
 * a symlinked *directory* (`docs/` → somewhere else) makes writeFileAtomic
 * mkdir and rename into the resolved parent, silently editing files outside the
 * repo that `git checkout .` can never restore. Resolve the deepest existing
 * ancestor and require it to sit inside the workspace — the same confinement
 * discipline as init.mjs and prompt.mjs.
 */
async function assertInsideWorkspace(target, abs) {
  const realTarget = await fs.realpath(target)
  let dir = path.dirname(abs)
  for (;;) {
    try {
      const real = await fs.realpath(dir)
      const rel = path.relative(realTarget, real)
      if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) {
        throw new UpgradeError(`resolves outside the workspace (via ${path.relative(target, dir)}/)`)
      }
      return
    } catch (err) {
      if (err instanceof UpgradeError) throw err
      const parent = path.dirname(dir)
      if (parent === dir) return          // nothing of the path exists yet
      dir = parent
    }
  }
}

/** Execute a plan. Mutates each entry's action/note to the actual outcome. */
async function applyPlan(target, plan, baseDir, theirsDir) {
  const needsTmp = plan.some((p) => p.action === 'merge')
  // Scratch lives outside the workspace: a killed run must not leave working
  // copies behind that then show up in map/doctor/git status.
  const tmpDir = needsTmp ? await fs.mkdtemp(path.join(os.tmpdir(), 'truss-upgrade-')) : null
  try {
    for (const p of plan) {
      if (p.action === 'skip' || p.action === 'report') continue
      const abs = path.join(target, p.rel)
      // One failed file must not abandon the run half-applied with a bare errno.
      try {
        if (p.action === 'write') {
          const symlink = await writeWorkspaceFile(target, abs, await fs.readFile(path.join(theirsDir, p.rel)))
          p.action = 'written'
          if (symlink) p.note += ' (replaced a symlink)'
          continue
        }

        const mine = await fs.readFile(abs, 'utf8')
        let base = await fs.readFile(path.join(baseDir, p.rel), 'utf8')
        let theirs = await fs.readFile(path.join(theirsDir, p.rel), 'utf8')
        if (p.rel === 'AGENTS.md') {
          base = alignGeneratedBlocks(mine, base)
          theirs = alignGeneratedBlocks(mine, theirs)
        }

        const { text, conflicts, reason } = await mergeThreeWay(tmpDir, p.rel, mine, base, theirs)
        if (text === null) {
          p.action = 'manual'; p.note = reason
        } else if (!conflicts && wellFormed(p.rel, text, mine)) {
          const symlink = await writeWorkspaceFile(target, abs, text)
          p.action = 'merged'; p.note = symlink ? 'merged cleanly (replaced a symlink)' : 'merged cleanly'
        } else {
          await assertInsideWorkspace(target, `${abs}.truss-merge`)
          await writeFileAtomic(`${abs}.truss-merge`, text)
          p.action = 'conflict'
          p.note = conflicts
            ? `conflict markers in ${p.rel}.truss-merge — your ${p.rel} is untouched`
            : `merge result is not valid ${path.extname(p.rel).slice(1) || 'content'} — see ${p.rel}.truss-merge, your ${p.rel} is untouched`
        }
      } catch (err) {
        p.action = 'failed'
        p.note = `${err.code || err.name}: ${err.message.split('\n')[0]} — nothing written for this file`
      }
    }
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * A line merge can be conflict-free and still produce a structurally broken
 * file. Only formats we can cheaply prove are checked; everything else passes.
 */
function wellFormed(rel, text, mine) {
  if (rel.endsWith('.json')) {
    try { JSON.parse(text) } catch { return false }
  }
  if (mine !== undefined) {
    // The block BODIES are aligned out of the merge, but the marker LINES are
    // still merge input. A merge that swallows one comes out "clean" and then
    // breaks render, set and BL-01 — in the boot file. Assert preservation, not
    // presence: every block that was sound before must still be sound after.
    const after = parseBlocks(text.split('\n'))
    for (const [id, block] of parseBlocks(mine.split('\n'))) {
      if (soundBlock(block) && !soundBlock(after.get(id))) return false
    }
  }
  return true
}

// ── Command ──────────────────────────────────────────────────────────────────

/** A version string safe to interpolate into a path we later delete. */
const safeVersionTag = (v) => (/^[A-Za-z0-9._+-]+$/.test(v) ? v : 'unknown')

/** Make sure the backup directory can never be committed by a later `git add -A`. */
async function ensureBackupIgnored(target) {
  const gi = path.join(target, '.gitignore')
  const current = await readBuf(gi)
  if (current === null) return false
  const text = current.toString('utf8')
  if (text.split('\n').some((l) => l.trim() === '.truss.bak-*/')) return false
  await writeFileAtomic(gi, `${text}${text.endsWith('\n') ? '' : '\n'}\n# Engine kept aside by \`truss upgrade\` as a rollback copy — never committed.\n.truss.bak-*/\n`)
  return true
}

/**
 * Lift the workspace at `invokedCwd` (or --root) to the version of the engine
 * this script belongs to. See the file header for the contract.
 *
 * @param {string}  engineRoot  Absolute root of the NEW engine (from resolveRoot).
 * @param {string[]} argv       Arguments after "upgrade".
 * @param {string?} invokedCwd  The CLI caller's cwd; null keeps target = engineRoot (tests).
 * @returns {Promise<object>}   Result summary (also printed). Throws UpgradeError on fatal error.
 */
export async function runUpgrade(engineRoot, argv, invokedCwd = null) {
  const opts = parseUpgradeArgs(argv)
  const target = path.resolve(opts.root ?? invokedCwd ?? engineRoot)

  const newEngine = path.join(engineRoot, '.truss')
  const oldEngine = path.join(target, '.truss')

  if (path.resolve(newEngine) === path.resolve(oldEngine)) {
    throw new UpgradeError(
      'upgrade: the workspace and the new engine are the same directory; nothing was changed.\n' +
      '       upgrade runs the NEW engine against an EXISTING workspace:\n' +
      '         git clone --depth 1 https://github.com/KornLabs/truss.git /tmp/truss\n' +
      '         node /tmp/truss/.truss/bin/truss.mjs upgrade      # from your project directory',
    )
  }
  if (!(await exists(path.join(target, 'AGENTS.md'))) || !(await exists(path.join(oldEngine, 'baseline')))) {
    const stranded = (await fs.readdir(target).catch(() => []))
      .filter((n) => n.startsWith('.truss.bak-'))
    throw new UpgradeError(
      `upgrade: ${target} is not a Truss workspace (needs AGENTS.md and .truss/baseline/); nothing was changed.\n` +
      (stranded.length
        ? `       An earlier run left ${stranded[0]}/ here — if .truss/ is missing or incomplete, restore it first:\n` +
          `         rm -rf .truss && mv ${stranded[0]} .truss\n`
        : '') +
      '       Otherwise run this from the project you want to upgrade, or pass --root <path>.',
    )
  }

  const newVersion = ((await readBuf(path.join(newEngine, 'VERSION')))?.toString('utf8') ?? '?').trim()
  const oldVersion = ((await readBuf(path.join(oldEngine, 'VERSION')))?.toString('utf8') ?? 'unknown').trim()
  if (oldVersion === newVersion && !opts.force) {
    console.log(`\n  Already at ${newVersion} — nothing to do. (--force re-applies anyway.)\n`)
    return { target, from: oldVersion, to: newVersion, upToDate: true, plan: [] }
  }

  // Clear a staging directory an interrupted run left behind BEFORE any gate.
  // It is engine scratch, never user content — but git sees it as an untracked
  // directory, so leaving it here would make the dirty-tree gate below abort
  // every retry and tell the adopter to commit a full copy of the engine into
  // their repository. The recovery has to come first to be a recovery at all.
  const incoming = path.join(target, INCOMING)
  await fs.rm(incoming, { recursive: true, force: true }).catch(() => {})

  // Read BEFORE the engine is touched — --dry-run never swaps anything, and the
  // real run swaps a few steps below (see "Engine swap"). Reading here rather
  // than after the swap is what makes this a report on the workspace's actual
  // OLD engine, not on whatever .truss/ happens to be by the time we get here.
  const engineDivergence = await verifyEngine(oldEngine)

  // --dry-run writes nothing, so it must never be gated on a clean tree: it is
  // exactly what a cautious user wants to run BEFORE committing.
  if (opts.dryRun) {
    const theirsDir = path.join(newEngine, 'baseline')
    const groups = await discoverGroups(theirsDir)
    const selected = await readSelectedGroups(target, groups)
    const plan = await planBaseline(
      target,
      path.join(oldEngine, 'baseline'),
      theirsDir,
      { exclude: buildExcludes(groups, selected) },
    )
    printReport({ target, from: oldVersion, to: newVersion, plan, backup: null, dryRun: true, engineDivergence,
      legacyDecisionLog: await hasLegacyDecisionLog(target) })
    return { target, from: oldVersion, to: newVersion, plan, dryRun: true, engineDivergence }
  }

  // The working tree is the undo. Refuse to merge into uncommitted work rather
  // than build a second backup mechanism on top of the one already there.
  if (!process.env.TRUSS_NO_GIT && await isGitCheckout(target)) {
    // A missing git binary is a quiet skip here (lib/git.mjs discipline); the
    // merge step reports it loudly enough on its own.
    const dirty = await execFileP('git', ['-C', target, 'status', '--porcelain'], { timeout: 5000 })
      .then((r) => r.stdout.trim()).catch(() => '')
    if (dirty && !opts.force) {
      throw new UpgradeError(
        'upgrade: the workspace has uncommitted changes; nothing was changed.\n' +
        '       Commit or stash first — that commit is your rollback. Or pass --force.\n' +
        '       To look without committing: --dry-run.',
      )
    }
  } else if (!await isGitCheckout(target)) {
    console.log('\n  Note: not a git checkout — there is no commit to roll back to.')
    console.log('  The old engine is kept as a backup, but merged files are not recoverable.')
  }

  // ── Engine swap ──
  // Stage first, swap by two renames. The slow, failure-prone copy happens while
  // the workspace is still fully intact, so an interrupted run leaves nothing
  // but .truss.incoming/ — never a workspace without an engine, and never a new
  // VERSION sitting on a half-copied tree that the next run would mistake for
  // an upgrade already done.
  const backup = path.join(target, `.truss.bak-${safeVersionTag(oldVersion)}`)
  if (await exists(backup)) {
    throw new UpgradeError(
      `upgrade: ${path.basename(backup)}/ already exists; nothing was changed.\n` +
      '       An earlier upgrade left it behind. Finish or discard that one first —\n' +
      '       it may still be the only copy of your previous engine.',
    )
  }
  try {
    await fs.cp(newEngine, incoming, { recursive: true })
    const customSrc = path.join(oldEngine, 'prompts', 'custom')
    if (await exists(customSrc)) {
      await fs.rm(path.join(incoming, 'prompts', 'custom'), { recursive: true, force: true })
      await fs.cp(customSrc, path.join(incoming, 'prompts', 'custom'), { recursive: true })
    }
  } catch (err) {
    await fs.rm(incoming, { recursive: true, force: true }).catch(() => {})
    throw new UpgradeError(`upgrade: staging the new engine failed (${err.message}); nothing was changed.`)
  }
  const customRestored = await exists(path.join(oldEngine, 'prompts', 'custom'))
  try {
    await fs.rename(oldEngine, backup)
  } catch (err) {
    // Windows in particular: an editor or indexer holding a handle inside
    // .truss/ makes this EPERM. Nothing has moved yet, so this is still a
    // clean abort — but only if it says so instead of escaping as a raw errno.
    await fs.rm(incoming, { recursive: true, force: true }).catch(() => {})
    throw new UpgradeError(
      `upgrade: moving the old engine aside failed (${err.message}); nothing was changed.\n` +
      '       Close anything holding files open under .truss/ and try again.',
    )
  }
  try {
    await fs.rename(incoming, oldEngine)
  } catch (err) {
    // Compensate — and never claim a restore that did not happen: at this point
    // the workspace has no .truss/ at all, which the message has to say.
    const restored = await fs.rename(backup, oldEngine).then(() => true).catch(() => false)
    await fs.rm(incoming, { recursive: true, force: true }).catch(() => {})
    throw new UpgradeError(
      `upgrade: swapping the engine in failed (${err.message}); ` +
      (restored
        ? 'the old engine was restored.'
        : `the old engine could NOT be restored — it is at ${path.basename(backup)}/.\n` +
          `       Recover with: mv ${path.basename(backup)} .truss`),
    )
  }

  // ── Baseline reconciliation, base read from the backup ──
  const baseDir = path.join(backup, 'baseline')
  const theirsDir = path.join(oldEngine, 'baseline')
  const groups = await discoverGroups(theirsDir)
  const selected = await readSelectedGroups(target, groups)
  const plan = await planBaseline(
    target,
    baseDir,
    theirsDir,
    { exclude: buildExcludes(groups, selected) },
  )
  await applyPlan(target, plan, baseDir, theirsDir)
  const gitignoreUpdated = await ensureBackupIgnored(target).catch(() => false)

  const result = { target, from: oldVersion, to: newVersion, backup, customRestored, gitignoreUpdated, plan, engineDivergence }
  printReport({ ...result, dryRun: false, legacyDecisionLog: await hasLegacyDecisionLog(target) })
  // A run that still needs a human must not look like a clean one to a script.
  if (plan.some((p) => ['conflict', 'manual', 'failed', 'report'].includes(p.action))) {
    process.exitCode = EXIT_NEEDS_ATTENTION
  }
  return result
}

// ── Report ───────────────────────────────────────────────────────────────────

const ACTION_LABEL = {
  write: 'would write', written: 'updated', merge: 'would merge', merged: 'merged',
  conflict: 'CONFLICT', manual: 'manual', failed: 'FAILED', report: 'review', skip: 'skipped',
}

const ENGINE_SAMPLE_LIMIT = 8

/** Total files named by a verifyEngine() result (0 when there is no divergence). */
function engineDivergenceTotal(engineDivergence) {
  if (!engineDivergence) return 0
  return engineDivergence.modified.length + engineDivergence.missing.length
    + engineDivergence.extra.length + engineDivergence.unreadable.length
}

/**
 * The truthful line(s) about local engine changes — the measured problem this
 * whole decision exists to fix (`upgrade --force` reverted lib/+checks/ without
 * a trace, and the report never said so). Worded for whichever side of the
 * swap the caller is reporting from:
 *   null                   no manifest to check against — say the swap is unverified
 *   known === 0, no unreadable   manifest present, clean — say nothing was at risk
 *   known > 0              name the files (bounded sample) and where to recover them
 *   unreadable.length > 0  named separately (Defect 1) — never known to be "local
 *                          changes", only known to be unverifiable
 */
/**
 * True when this workspace still keeps its decisions in one state/decisions.md
 * with entries in it, and has not split (D-087). `upgrade` cannot perform that
 * migration — it never writes state/ — so the report names it instead.
 */
async function hasLegacyDecisionLog(target) {
  try {
    const names = await fs.readdir(path.join(target, 'state', 'decisions'))
    if (names.some((n) => /^D-\d{3}\.md$/.test(n))) return false
  } catch { /* no directory — the normal legacy case */ }
  try {
    const log = await fs.readFile(path.join(target, 'state', 'decisions.md'), 'utf8')
    return /^##\s+D-\d{3}\b/m.test(log)
  } catch { return false }
}

function engineDivergenceLines(engineDivergence, { dryRun, backup }) {
  if (engineDivergence === null) {
    return [dryRun
      ? '  The current engine has no release manifest to check against — local engine changes, if any, would not be detected.'
      : '  The previous engine had no release manifest to check against — local engine changes, if any, were replaced without being detected.']
  }
  const { modified, missing, extra, unreadable } = engineDivergence
  const known = modified.length + missing.length + extra.length
  const lines = []
  if (known === 0 && unreadable.length === 0) {
    return [dryRun
      ? '  The current engine matches its release manifest — nothing local would be lost in the swap.'
      : '  The previous engine matched its release manifest — nothing local was lost in the swap.']
  }
  if (known > 0) {
    const labelled = [
      ...modified.map(f => `modified ${f}`),
      ...missing.map(f => `missing ${f}`),
      ...extra.map(f => `extra ${f}`),
    ].sort()
    const shown = labelled.slice(0, ENGINE_SAMPLE_LIMIT)
    const more = labelled.length - shown.length
    const list = `${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`
    lines.push(dryRun
      ? `  ${known} engine file(s) carry local changes and would be replaced by the swap: ${list}`
      : `  ${known} engine file(s) carried local changes and were replaced: ${list}`)
    lines.push(dryRun
      ? '  Nothing destroyed yet — this is exactly what --dry-run is for; compare these by hand before re-running for real.'
      : `  Recover them from the backup: ${path.basename(backup)}/`)
  }
  // Unreadable files were never hashed (Defect 1) — this process could not
  // confirm they carry local changes, only that it could not check them, so
  // they are reported separately rather than folded into "carried local
  // changes" (which they may or may not be true of).
  if (unreadable.length > 0) {
    lines.push(`  ${unreadable.length} engine file(s) could not be read at all (a permissions problem?) and were not verified: ${unreadable.join(', ')}`)
  }
  return lines
}

function printReport({ target, from, to, plan, backup, customRestored, gitignoreUpdated, dryRun, engineDivergence, legacyDecisionLog }) {
  const L = []
  L.push('')
  L.push(dryRun ? `  truss upgrade — dry run: ${from} → ${to}` : `  truss upgrade — ${from} → ${to}`)
  L.push(`  ${target}`)
  L.push('')

  if (dryRun) {
    L.push(...engineDivergenceLines(engineDivergence, { dryRun: true, backup }))
    L.push('')
  } else {
    L.push(`  Engine replaced. Previous engine kept at ${path.basename(backup)}/`)
    L.push(...engineDivergenceLines(engineDivergence, { dryRun: false, backup }))
    if (customRestored) L.push('  Your prompts/custom/ was carried over.')
    if (gitignoreUpdated) L.push('  Added .truss.bak-*/ to .gitignore so the backup is never committed.')
    L.push('')
  }

  if (plan.length === 0) {
    // The false claim from the measurement: a workspace with a divergent engine
    // and an unchanged baseline is NOT "the engine swap was the whole upgrade" —
    // the engine half of that swap replaced locally-adapted files. Say so instead.
    L.push(engineDivergenceTotal(engineDivergence) > 0
      ? '  No baseline file changed between these versions — but the engine half was not a no-op; see the engine note above.'
      : '  No baseline file changed between these versions — the engine swap was the whole upgrade.')
  } else {
    L.push('  Baseline files:')
    for (const p of plan) L.push(`    ${(ACTION_LABEL[p.action] || p.action).padEnd(11)} ${p.rel.padEnd(26)} ${p.note}`)
  }
  L.push('')

  const attention = plan.filter((p) => ['conflict', 'manual', 'failed', 'report'].includes(p.action))

  // `upgrade` never writes state/ (see the SEED note in the file header), so a
  // migration that only touches state/ can never be applied here — it would be
  // invisible to the adopter otherwise, and the benefit of the change with it.
  if (legacyDecisionLog) {
    L.push('  Optional migration:')
    L.push('    This workspace keeps its decisions in one state/decisions.md. Splitting them into')
    L.push('    state/decisions/<ID>.md shrinks the boot index (~77 → ~20 tokens per decision) and')
    L.push('    makes looking one up cost a single small file. Nothing forces it — the single-file')
    L.push('    layout stays supported and reports nothing.')
    L.push('      node .truss/bin/truss.mjs split-decisions --dry-run')
    L.push('')
  }

  L.push('  Next steps:')
  if (dryRun) {
    L.push('    1. Re-run without --dry-run to apply.')
  } else if (attention.length === 0) {
    // render/map before doctor: a version can change what the generated files
    // should contain, so running doctor first reports drift the adopter did not
    // cause and cannot read as anything but their own workspace going red.
    L.push('    1. node .truss/bin/truss.mjs render && node .truss/bin/truss.mjs map')
    L.push('    2. node .truss/bin/truss.mjs doctor')
    L.push(`    3. Looks right? Remove the backup: rm -rf ${path.basename(backup)}`)
    L.push(`       Anything wrong? Roll back: git checkout . && rm -rf .truss && mv ${path.basename(backup)} .truss`)
  } else {
    L.push(`    1. ${attention.length} file(s) need judgment — paste the prompt below into your AI tool.`)
    L.push('    2. node .truss/bin/truss.mjs render && node .truss/bin/truss.mjs map')
    L.push('    3. node .truss/bin/truss.mjs doctor')
    L.push(`    4. Then remove the backup: rm -rf ${path.basename(backup)}`)
    L.push('')
    L.push('  Prompt for your AI tool:')
    L.push('    "Read AGENTS.md fully, then follow §1 load order. This workspace was just')
    L.push(`      upgraded from Truss ${from} to ${to}. Resolve the files listed above:`)
    L.push('      mark each as CONFLICT, manual, FAILED or review, taking only the new baseline rules and')
    L.push('      leaving everything project-specific intact. The old baseline is at')
    L.push(`      ${path.basename(backup)}/baseline/ if you need the before-state."`)
  }
  L.push('')
  console.log(L.join('\n'))
}
