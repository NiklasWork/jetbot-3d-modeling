// lib/engine-manifest.mjs — engine integrity manifest (D-070).
//
// The workspace half of an install already has a reference: .truss/baseline/
// is the untouched scaffold and serves `upgrade` as a 3-way merge base. The
// engine source itself (lib/, checks/, bin/, ...) has none — an adopter who
// patches the engine locally has no way to know it, and `upgrade` had no way
// to tell them either. This module is that reference for the engine half.
//
// GENERATION AND VERIFICATION SHARE ONE FUNCTION (computeEngineHashes). If the
// release wrote the manifest with one hashing rule and a check verified it with
// another, the two would drift silently apart and the feature would be worse
// than nothing: it would report "clean" on an engine that no longer matches
// what shipped. Every caller — writeManifest() at release time, verifyEngine()
// at upgrade/doctor time — goes through the same walk and the same hash.

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { writeFileAtomic } from './scaffold.mjs'

/** The manifest's own path, relative to the engine dir. */
export const MANIFEST_REL = 'MANIFEST.sha256'

// Scope rule — walk everything under the engine dir EXCEPT:
//   out/            runtime state the tool itself writes, not engine source
//   prompts/custom/ user content; `upgrade` already carries it over verbatim
//   MANIFEST.sha256 the manifest can't hash itself
// This is deliberately the exact same cut the Forge release script's runtime
// rsync already uses (`--exclude /out/ --exclude /prompts/custom/`), so a
// workspace kept in sync by that rsync verifies clean against the manifest it
// receives.
/** Paths under the engine dir the manifest never hashes. Exported because the
 *  Forge release gate has to exempt exactly these and must not re-type them:
 *  a gate that judges by a second copy of the rule drifts from the rule it
 *  guards. It did — the gate aborted a release over `.truss/out/doctor.json`,
 *  a file the manifest never looks at. */
export const EXCLUDED_RELS = new Set(['out', 'prompts/custom', MANIFEST_REL])

/**
 * Every regular file under `dir`, as POSIX-separated paths relative to it.
 * An unreadable directory is reported as its own entry (rel + trailing "/",
 * a shape no real file rel can equal) rather than silently returning [] —
 * the caller must be able to tell "this subtree could not be checked" apart
 * from "everything under it was deleted" (Defect 1: a false accusation is
 * worse than an admitted blind spot).
 */
async function walk(dir, rel = '') {
  const abs = rel ? path.join(dir, rel) : dir
  let entries
  try { entries = await fs.readdir(abs, { withFileTypes: true }) }
  catch { return [(rel || '.') + '/'] }
  const out = []
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (EXCLUDED_RELS.has(r)) continue
    // withFileTypes reports the entry's own type (lstat-like): a symlink is
    // neither isDirectory() nor isFile(), so it is skipped here without ever
    // being followed — no separate symlink check needed.
    if (e.isDirectory()) out.push(...await walk(dir, r))
    else if (e.isFile()) out.push(r)
  }
  return out
}

const byRel = (a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)

/**
 * Hash every engine source file. sha256 over the raw bytes — never decoded as
 * utf8, since the engine ships binary assets (vendor/, images).
 *
 * Unreadability — a file this process cannot open, or a directory it cannot
 * list — is a REPORTED STATE, never an exception: this is the one function
 * both `doctor` and `upgrade` route through, and a raw errno escaping here
 * used to take out the entire ST module in one throw (Defect 1). Such an
 * entry gets `sha: null`; a directory sentinel from walk() (rel ending "/")
 * is passed through the same way instead of being opened as a file.
 * verifyEngine() turns both into its `unreadable` bucket.
 * @returns {Promise<Array<{rel:string, sha:string|null}>>} sorted by `rel`
 */
export async function computeEngineHashes(engineDir) {
  const rels = await walk(engineDir)
  const entries = await Promise.all(rels.map(async (rel) => {
    if (rel.endsWith('/')) return { rel, sha: null } // unreadable-directory sentinel from walk()
    try {
      const buf = await fs.readFile(path.join(engineDir, rel))
      return { rel, sha: createHash('sha256').update(buf).digest('hex') }
    } catch {
      return { rel, sha: null } // unreadable file — see the function comment
    }
  }))
  return entries.sort(byRel)
}

/**
 * `sha256sum`-style manifest body: `<hex>  <rel>` lines, sorted, LF, trailing
 * newline. Rejects a filename containing "\n" outright — a line-based format
 * has no way to represent one without an escaping scheme, and one newline
 * would split a single entry into two and corrupt every line after it
 * (Defect 4). This should never occur in engine source, so refusing to write
 * is the whole fix.
 */
export function formatManifest(entries) {
  const sorted = [...entries].sort(byRel)
  for (const { rel } of sorted) {
    if (rel.includes('\n')) {
      throw new Error(`engine-manifest: refusing to write a manifest — filename contains a newline: ${JSON.stringify(rel)}`)
    }
  }
  return sorted.map(({ sha, rel }) => `${sha}  ${rel}`).join('\n') + '\n'
}

/** Compute and write the manifest for `engineDir`. Returns the entry count. */
export async function writeManifest(engineDir) {
  const entries = await computeEngineHashes(engineDir)
  await writeFileAtomic(path.join(engineDir, MANIFEST_REL), formatManifest(entries))
  return entries.length
}

/**
 * Read the manifest at `engineDir`. Returns null both when it is absent AND
 * when it is present but unusable (see the size-0 comment below) — callers
 * must treat the two identically.
 */
export async function readManifest(engineDir) {
  let content
  try { content = await fs.readFile(path.join(engineDir, MANIFEST_REL), 'utf8') }
  catch { return null }
  const map = new Map()
  // Split on \r?\n, not '\n' alone: a manifest saved or hand-edited with CRLF
  // line endings otherwise leaves a trailing \r on every line, which the "."
  // in the regex below cannot match (Defect 2) — every entry then fails to
  // parse and gets dropped as "corrupted".
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue
    const m = line.match(/^([0-9a-f]{64}) {2}(.+)$/)
    if (!m) continue // a hand-edited or corrupted line — ignore rather than crash
    map.set(m[2], m[1])
  }
  // A manifest file that exists but yields ZERO parseable entries (truncated,
  // binary-clobbered, or otherwise garbage) is not evidence the engine lost
  // every file — it is a manifest verifyEngine cannot trust (Defect 2). D-070's
  // governing rule is that silence beats a wrong accusation, so this is treated
  // exactly like "no manifest" rather than being diffed against an empty map,
  // which would report every engine file as "extra".
  if (map.size === 0) return null
  return map
}

/**
 * Compare the engine on disk against its manifest.
 * @returns {Promise<null|{modified:string[], missing:string[], extra:string[], unreadable:string[]}>}
 *   null when there is no manifest to check against — callers must then emit
 *   nothing, not report "no manifest" as a finding (test workspaces and any
 *   instance shipped before D-070 have none). `unreadable` names manifest
 *   entries this process could not verify at all (an unreadable file, or one
 *   that fell inside an unreadable directory) — never mixed into `modified`
 *   or `missing`, since neither is actually known for them (Defect 1).
 */
export async function verifyEngine(engineDir) {
  const manifest = await readManifest(engineDir)
  if (manifest === null) return null

  const current = await computeEngineHashes(engineDir)
  const currentMap = new Map(current.map(({ rel, sha }) => [rel, sha]))
  // Directory sentinels from walk() (rel ending "/", stripped of the slash).
  // A rel equal to '.' means the walk root itself could not be read, which
  // swallows everything under it.
  const unreadableDirs = current.filter(({ rel }) => rel.endsWith('/')).map(({ rel }) => rel.slice(0, -1))
  const underUnreadableDir = (rel) => unreadableDirs.some((d) => d === '.' || rel === d || rel.startsWith(`${d}/`))

  const modified = []
  const missing = []
  const unreadable = []
  for (const [rel, sha] of manifest) {
    if (underUnreadableDir(rel)) { unreadable.push(rel); continue }
    const curSha = currentMap.get(rel)
    if (curSha === undefined) missing.push(rel)
    else if (curSha === null) unreadable.push(rel) // the file itself was unreadable
    else if (curSha !== sha) modified.push(rel)
  }
  // Directory sentinels never count as "extra" — they are not files that exist
  // on disk, just a note that a subtree could not be enumerated.
  const extra = [...currentMap.keys()].filter((rel) => !rel.endsWith('/') && !manifest.has(rel))

  modified.sort(); missing.sort(); extra.sort(); unreadable.sort()
  return { modified, missing, extra, unreadable }
}
