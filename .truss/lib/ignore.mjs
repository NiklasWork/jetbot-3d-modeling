// lib/ignore.mjs — user-controllable scan-exclusion layer (single source of truth)
//
// The problem this solves: truss walks the whole workspace tree for two purposes
// — building state/map.md (map) and flagging untracked/broken content (doctor).
// A legitimate but *foreign* bulk-data folder in the project root (probe data, a
// vendored dataset, a copied app-support directory) used to flood both: the map
// filled with UUID paths, doctor produced hundreds of duplicate findings. Git
// solved this with .gitignore decades ago; truss now honours the same signal and
// adds a truss-owned .trussignore for exclusions that are map/doctor-specific.
//
// Precedence (a path is excluded if the LAST matching rule excludes it):
//   1. engine hardcodes  — .git, node_modules, .truss/out (always, never scanned)
//   2. .gitignore        — respected by default (opt out with TRUSS_NO_GITIGNORE=1)
//   3. .trussignore      — truss-owned; also the layer agents maintain per project
// Later files win, so .trussignore can re-include something .gitignore excluded
// via a negation (`!path`).
//
// Syntax is a practical subset of gitignore: blank lines, `#` comments, `!`
// negation, a trailing `/` for directory-only rules, a leading or embedded `/`
// for root-anchored rules, and `*` `?` `**` globs. Character classes ([a-z]) are
// intentionally not supported — they do not appear in real ignore files here.
//
// The predicate is applied identically by map's walk AND doctor's walk, so the
// two never diverge (map-bundle byte-identity, WP-G, is preserved).

import fs from 'node:fs/promises'
import path from 'node:path'

// Always excluded, regardless of any ignore file. These are engine-internal or
// so universally non-content that scanning them is never useful. Kept in sync
// with the historical hardcodes in workspace.mjs / map.mjs (additive, not a
// replacement — those still stand as defence in depth).
const ENGINE_HARDCODES = [
  '.git/',
  'node_modules/',
  '.truss/out/',
  // The engine `truss upgrade` moved aside, and its staging directory. Both are
  // engine copies, not project content — scanning them reports a whole install
  // as unmanaged files.
  '.truss.bak-*/',
  '.truss.incoming/',
]

/**
 * Translate a single gitignore glob segment (no '/') into a regex body that
 * matches one path segment. Supports * ? only (no ** inside a bare segment).
 */
function segmentToRegex(seg) {
  let out = ''
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i]
    if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return out
}

/**
 * Translate an anchored (slash-bearing) gitignore pattern into a regex matching
 * a full relative path. Handles ** (spans path segments), * and ?.
 */
function pathToRegex(pattern) {
  let out = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      // ** — any number of path segments (including zero)
      i += 2
      if (pattern[i] === '/') { out += '(?:.*/)?'; i++ }
      else out += '.*'
    } else if (pattern[i] === '*') {
      out += '[^/]*'; i++
    } else if (pattern[i] === '?') {
      out += '[^/]'; i++
    } else {
      out += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&'); i++
    }
  }
  return out
}

/**
 * Parse gitignore-syntax text into compiled rules. Order is preserved — matching
 * is last-rule-wins, matching git's semantics.
 * @returns {Array<{negate:boolean, dirOnly:boolean, anchored:boolean, re:RegExp, src:string}>}
 */
export function parseIgnoreRules(text) {
  const rules = []
  if (!text) return rules
  for (const raw of text.split(/\r?\n/)) {
    // Trailing unescaped whitespace is not significant in gitignore.
    let line = raw.replace(/((?:^|[^\\])(?:\\\\)*)\s+$/, '$1')
    if (line === '' || line.startsWith('#')) continue

    let negate = false
    if (line.startsWith('!')) { negate = true; line = line.slice(1) }
    // Unescape a leading \# or \! (literal '#'/'!' at start of a pattern).
    line = line.replace(/^\\([#!])/, '$1')

    let dirOnly = false
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1) }
    if (line === '') continue

    // A leading '/' anchors to the root; any other embedded '/' also anchors
    // (gitignore rule). A pattern with no slash matches a basename at any depth.
    let anchored = false
    if (line.startsWith('/')) { anchored = true; line = line.slice(1) }
    else if (line.includes('/')) { anchored = true }

    const re = anchored
      ? new RegExp('^' + pathToRegex(line) + '$')
      : new RegExp('^' + segmentToRegex(line) + '$')

    rules.push({ negate, dirOnly, anchored, re, src: raw })
  }
  return rules
}

/**
 * Build the exclusion predicate for a workspace root.
 *
 * @param {string} root
 * @param {{respectGitignore?:boolean}} [opts]
 * @returns {Promise<{isIgnored:(relPath:string,isDir:boolean)=>boolean, sources:string[], rules:Array}>}
 */
export async function loadIgnore(root, opts = {}) {
  const respectGitignore =
    opts.respectGitignore ?? (process.env.TRUSS_NO_GITIGNORE ? false : true)

  const sources = []
  const rules = [...parseIgnoreRules(ENGINE_HARDCODES.join('\n'))]

  const readMaybe = async (name) => {
    try { return await fs.readFile(path.join(root, name), 'utf8') }
    catch { return null }
  }

  if (respectGitignore) {
    const gi = await readMaybe('.gitignore')
    if (gi != null) { rules.push(...parseIgnoreRules(gi)); sources.push('.gitignore') }
  }
  const ti = await readMaybe('.trussignore')
  if (ti != null) { rules.push(...parseIgnoreRules(ti)); sources.push('.trussignore') }

  return { isIgnored: makePredicate(rules), sources, rules }
}

/**
 * Compile rules into a fast path predicate. Evaluates each ancestor level of the
 * path so that ignoring a directory ignores everything beneath it, and applies
 * last-rule-wins including negations.
 */
export function makePredicate(rules) {
  return function isIgnored(relPath, isDir = false) {
    const clean = relPath.replace(/\/+$/, '')
    if (clean === '' || clean === '.') return false
    const segs = clean.split('/')

    let ignored = false
    let curr = ''
    for (let i = 0; i < segs.length; i++) {
      curr = curr ? curr + '/' + segs[i] : segs[i]
      const atLeaf = i === segs.length - 1
      const segIsDir = atLeaf ? isDir : true // intermediate segments are dirs
      const basename = segs[i]

      for (const rule of rules) {
        if (rule.dirOnly && !segIsDir) continue
        const target = rule.anchored ? curr : basename
        if (rule.re.test(target)) ignored = !rule.negate
      }
    }
    return ignored
  }
}

// A no-op predicate for callers that need the shape but no rules (tests, etc.).
export const NEVER_IGNORE = () => false
