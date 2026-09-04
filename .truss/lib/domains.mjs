// lib/domains.mjs — what a "domain" is, defined exactly once (U5).
//
// A **domain** is a file `context/**.md` whose YAML frontmatter carries a
// non-empty `focus:`. That is the whole definition — there is no registration
// list, no `domains:` block in state/current.md, and no entry in profile.md.
// The evidence lives in the file itself, so the register can be *generated*
// (`truss status`) instead of hand-maintained, and can therefore never drift
// from the files it describes.
//
// Two consumers need this rule — `truss status` (which prints the register) and
// checks/sy.mjs (SY-01 drops its `next:` requirement once domains exist, SY-12
// reports a global `next:` that outlived them). Two copies of the rule would be
// exactly the drift this package removes, so both import from here.
//
// Pure: everything below works off ctx.files, which loadWorkspace already fills
// with every non-ignored context/**/*.md. No I/O, so checks/ stay hermetic.

import { parseFrontmatter, parseFrontmatterList } from './md.mjs'

/** Directory that holds domain files. Trailing slash: it is a path prefix. */
export const DOMAIN_DIR = 'context/'

// A key written as a dash or `none` says "nothing here" — it is the idiom the
// baseline itself uses (`blockers: none`). Treating it as content would make
// `focus: —` declare a domain and `next: —` count as one open point.
const PLACEHOLDER_RE = /^(none|[-–—])$/i

/**
 * The trimmed value if it says something, '' if it says "nothing here".
 * Exported because checks/sy.mjs judges the *same* idiom on the other side of
 * the split (a global `next: —` is not an entry either) — one predicate, so the
 * two sides cannot drift into disagreeing about what an empty value looks like.
 * @param {string|undefined|null} value
 * @returns {string}
 */
export const meaningful = (value) => {
  const t = (value ?? '').trim()
  return t && !PLACEHOLDER_RE.test(t) ? t : ''
}

/**
 * Read one file context as a domain.
 * @param {{relPath?: string, lines?: string[], stat?: object}} fileCtx
 * @param {string} [relPath] path to judge by — the ctx.files key, which is the
 *        authority; falls back to fileCtx.relPath when called with one argument.
 * @returns {null | {relPath: string, name: string, focus: string,
 *                   next: string[], blockers: string[], stat: object|null}}
 *          null when the file is not a domain (wrong place, no frontmatter,
 *          or no meaningful focus:).
 */
export function readDomain(fileCtx, relPath) {
  const rel = relPath || fileCtx?.relPath
  if (!rel || !rel.startsWith(DOMAIN_DIR) || !rel.endsWith('.md')) return null
  if (!Array.isArray(fileCtx.lines)) return null

  const { data } = parseFrontmatter(fileCtx.lines)
  const focus = meaningful(data.focus)
  if (!focus) return null

  const entries = (value) => parseFrontmatterList(value).filter(meaningful)

  return {
    relPath: rel,
    // `context/recht.gruendung.md` → `recht.gruendung`. Dot names are a naming
    // convention only (docs/conventions.md); no code splits on the dot.
    name: rel.slice(DOMAIN_DIR.length).replace(/\.md$/, ''),
    focus,
    next: entries(data.next),
    blockers: entries(data.blockers),
    stat: fileCtx.stat || null,
  }
}

/**
 * Every domain in the workspace, ordered by path (stable, path-sorted).
 * @param {{files: Map<string, object>}} ctx
 * @returns {Array<ReturnType<typeof readDomain>>}
 */
export function listDomains(ctx) {
  const out = []
  for (const [rel, fileCtx] of ctx?.files?.entries() || []) {
    const domain = readDomain(fileCtx, rel)
    if (domain) out.push(domain)
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/**
 * Does this workspace have at least one domain? Short-circuits — SY-01 asks
 * this on every run and does not need the list.
 * @param {{files: Map<string, object>}} ctx
 */
export function hasDomains(ctx) {
  for (const [rel, fileCtx] of ctx?.files?.entries() || []) {
    if (readDomain(fileCtx, rel)) return true
  }
  return false
}
