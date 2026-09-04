// checks/ph.mjs — Phase checks (PH-01 … PH-04)
//
// PH-01  E  phases.md grammar violated (unknown key, missing required, bad exit item)
// PH-02  E  current: pointer doesn't match any defined phase id
// PH-03  W  forbidden-globs match uncommitted git paths
// PH-04  E/W  --gate only: machine exit items unmet; human checklist output

import fs from 'node:fs/promises'
import path from 'node:path'
import { parseExitItems, globToRegex } from '../lib/render.mjs'
import { parseHeadings, headingToAnchor, parsePhaseList, splitLines, PHASE_STRAY, PHASE_UNKNOWN_KEYS } from '../lib/md.mjs'
import { loadIgnore } from '../lib/ignore.mjs'
import { gitChangedPaths } from '../lib/git.mjs'
import { resolveCodeRoot } from '../lib/code-root.mjs'

// Declarative catalog of the checks this module implements (A2).
export const meta = [
  { id: 'PH-01', severity: 'E', title: 'phases.md grammar violated' },
  { id: 'PH-02', severity: 'E', title: 'current: points to an unknown phase' },
  { id: 'PH-03', severity: 'W', title: 'forbidden-globs match changed paths' },
  { id: 'PH-04', severity: 'E', title: 'Phase exit criteria unmet', description: '--gate only; also lists the human checklist' },
  { id: 'PH-05', severity: 'E', title: 'phases.md present but defines no phases', description: 'Guards against silent degradation (A4): a file that parses to zero phases' },
  { id: 'PH-06', severity: 'W', title: 'Exit file:/section: target unresolved (any phase)', description: 'Static check across all phases (A5); glob: stays gate-only' },
  { id: 'PH-07', severity: 'I', title: 'Forbidden-path evidence is incomplete', description: 'Reports when PH-03 cannot inspect a checkout or can only see uncommitted changes' },
]

const KNOWN_KEYS = new Set([
  'label', 'name', 'purpose', 'behavior',
  'allowed', 'forbidden', 'forbidden-globs',
  'read', 'exit',
])
const REQUIRED_KEYS = ['purpose', 'behavior', 'exit']

// Keys the phase grammar once defined and no longer does. A key retired by an
// engine change is a migration hint, not an error: an upgraded workspace must
// never go red for a line it wrote correctly under the previous version.
// Precedent: RETIRED_KEYS in lib/prefs.mjs, reported by BL-03 (checks/bl.mjs).
const RETIRED_KEYS = new Map([
  ['prompts', 'the prompt library left the engine; put your own prompts in `.truss/prompts/custom/` and open them by hand'],
])

// Two parsers reject a phase key: lib/md.mjs drops keys its own list does not
// know (they arrive via PHASE_UNKNOWN_KEYS), and PH-01 rescans Object.keys(def)
// for keys md.mjs accepted but the grammar here does not. Both paths must judge
// a key the same way, so both build their finding here.
function unknownKeyFinding(phaseId, key) {
  const retired = RETIRED_KEYS.get(key)
  return {
    id: 'PH-01', severity: retired ? 'I' : 'E',
    file: 'state/phases.md',
    message: retired
      ? `phase '${phaseId}': '${key}' is retired — ${retired}`
      : `phase '${phaseId}': unknown key '${key}'`,
    fix: retired
      ? `Delete the '${key}:' line from phase '${phaseId}' — it no longer affects anything`
      : `Remove '${key}'. Known keys: ${[...KNOWN_KEYS].join(', ')}.`,
  }
}

/**
 * @param {import('../lib/workspace.mjs').WorkspaceContext} ctx
 * @returns {Promise<Array>}
 */
export async function run(ctx) {
  const findings = []
  const { root, gate } = ctx
  // Mirror the shape lib/workspace.mjs always builds, so a hand-made ctx can
  // never crash the check the way a bare destructure would.
  const phases = ctx.phases ?? { frontmatter: {}, ordered: [], defs: new Map() }
  const codeRootRel = ctx.codeRoot?.rel ?? (await resolveCodeRoot(root)).rel

  const { ordered, defs, frontmatter } = phases

  // ── PH-05: parse-degradation guard (A4) ─────────────────────────────────────
  // The file exists (has a stat) but parsed to zero phase definitions — e.g. the
  // "## <id>" headings were renamed or malformed. Without this guard PH-01/PH-02/
  // PH-03 all iterate empty maps and doctor goes green at zero phase coverage.
  if (phases.stat && defs.size === 0) {
    findings.push({
      id: 'PH-05', severity: 'E',
      file: 'state/phases.md',
      message: 'state/phases.md defines no phases — no "## <phase-id>" sections were parsed',
      fix: 'Add at least one "## <phase-id>" section (kebab-case) with purpose/behavior/exit, per STRUKTUR.md §6',
    })
    return findings
  }

  // ── PH-01: Grammar ──────────────────────────────────────────────────────────
  for (const [phaseId, def] of defs) {
    // Free text inside a phase section (D-061). The block is rendered verbatim
    // into AGENTS.md, so a stray line would otherwise land in every session boot
    // — silently, when it follows a key doctor does not otherwise validate.
    for (const line of def[PHASE_STRAY] ?? []) {
      findings.push({
        id: 'PH-01', severity: 'E',
        file: 'state/phases.md',
        message: `phase '${phaseId}': line is neither 'key: value' nor an indented continuation — '${line.length > 60 ? line.slice(0, 57) + '…' : line}'`,
        fix: 'Inside a phase section every line is "key: value"; wrap long values on an indented line. Move notes above the first "## <phase-id>" heading.',
      })
    }

    // Unknown keys — dropped by lib/md.mjs, or accepted there but not defined here
    for (const key of def[PHASE_UNKNOWN_KEYS] ?? []) {
      findings.push(unknownKeyFinding(phaseId, key))
    }
    for (const key of Object.keys(def)) {
      if (!KNOWN_KEYS.has(key)) findings.push(unknownKeyFinding(phaseId, key))
    }

    // Required keys
    for (const req of REQUIRED_KEYS) {
      if (!def[req]) {
        findings.push({
          id: 'PH-01', severity: 'E',
          file: 'state/phases.md',
          message: `phase '${phaseId}': required key '${req}' is missing`,
          fix: `Add '${req}: ...' under the ## ${phaseId} heading.`,
        })
      }
    }

    // exit item grammar
    if (def.exit) {
      for (const item of parseExitItems(def.exit)) {
        if (item.type === 'unknown') {
          findings.push({
            id: 'PH-01', severity: 'E',
            file: 'state/phases.md',
            message: `phase '${phaseId}': exit item not recognized — '${item.raw}'`,
            fix: `Prefix with 'file:', 'glob:', 'section:', or append '(human)'. Got: '${item.raw}'`,
          })
        }
      }
    }
  }

  // ── Absent is not broken (U4) ─────────────────────────────────────────────
  // No readable state/phases.md. lib/workspace.mjs always builds `phases` as an
  // object and attaches `stat` only when the file was actually READ, so
  // `!phases.stat` covers two very different states that must not be merged:
  //
  //   absent  → the workspace deliberately runs without a phase model. Silent.
  //   present but unreadable (permissions, a directory, invalid UTF-8) → broken.
  //             Left silent, a chmod would quietly strip a workspace of its
  //             gates and doctor would report a clean, phase-less project while
  //             a full phases.md sits on disk. That is the exact degradation
  //             this design is meant to prevent, so it stays an error — this is
  //             the finding the previously unreachable `if (!phases)` branch was
  //             written for.
  //
  // Everything above this line is silent on empty defs anyway; everything below
  // assumes a phase model exists. PH-05 keeps its E for a file that IS readable
  // and parses to nothing.
  if (!phases.stat) {
    if (await pathExists(path.resolve(root, 'state', 'phases.md'))) {
      findings.push({
        id: 'PH-01', severity: 'E',
        file: 'state/phases.md',
        message: 'state/phases.md exists but could not be read — unreadable, a directory, or not valid UTF-8',
        fix: 'Make state/phases.md a readable UTF-8 file, or remove it to run this workspace without a phase model.',
      })
    }
    return findings
  }

  // ── PH-02: current pointer valid ──────────────────────────────────────────
  const current = frontmatter?.current
  if (!current) {
    findings.push({
      id: 'PH-02', severity: 'E',
      file: 'state/phases.md',
      message: "frontmatter missing 'current:' key",
      fix: "Add 'current: <phase-id>' to the YAML frontmatter block.",
    })
  } else if (!defs.has(current)) {
    findings.push({
      id: 'PH-02', severity: 'E',
      file: 'state/phases.md',
      message: `current: '${current}' is not a defined phase — defined: ${[...defs.keys()].join(', ')}`,
      fix: `Change current: to one of: ${[...defs.keys()].join(', ')}.`,
    })
  }

  // ── PH-03: forbidden-globs of current phase ──────────────────────────────
  if (current && defs.has(current)) {
    const def = defs.get(current)
    const globsStr = def['forbidden-globs']
    if (globsStr) {
      const globs = parsePhaseList(globsStr)
      const { isIgnored } = await loadIgnore(root, { respectGitignore: false })
      const evidence = await changedPathEvidence(
        root,
        globs,
        isIgnored,
        codeRootRel,
      )
      for (const { glob, hits } of evidence.matches) {
        if (hits.length > 0) {
          const shown = hits.slice(0, 3).join(', ')
          const more = hits.length > 3 ? ` (+${hits.length - 3} more)` : ''
          findings.push({
            id: 'PH-03', severity: 'W',
            file: 'state/phases.md',
            message: `forbidden-glob '${glob}' matches ${hits.length} uncommitted path${hits.length !== 1 ? 's' : ''} in phase '${current}': ${shown}${more}`,
            fix: `Revert or move those changes before leaving '${current}', or narrow the pattern if it is too broad.`,
          })
        }
      }
      // Genuine unavailability (git disabled/errored) is always worth surfacing.
      // The inherent "uncommitted paths only" caveat is only emitted when it
      // actually qualifies a real PH-03 hit — otherwise it is noise on every
      // clean workspace (F-03).
      const anyHits = evidence.matches.some(m => m.hits.length > 0)
      const reasons = [...evidence.limited]
      if (anyHits) reasons.push(...evidence.uncommittedScopes)
      if (reasons.length > 0) {
        findings.push({
          id: 'PH-07', severity: 'I',
          file: 'state/phases.md',
          message: `forbidden-path coverage is limited: ${reasons.join('; ')}`,
          fix: 'Treat phase path rules as advisory. PH-03 can inspect uncommitted git paths, not changes already committed during this phase.',
        })
      }
    }
  }

  // ── PH-04: --gate exit checks ─────────────────────────────────────────────
  if (gate && current && defs.has(current)) {
    const def = defs.get(current)
    const items = parseExitItems(def.exit || '')
    const { isIgnored } = await loadIgnore(root, { respectGitignore: false })

    const humanItems = []
    const machineFailures = []

    for (const item of items) {
      switch (item.type) {
        case 'human':
          humanItems.push(item.raw.replace(/\s*\(human\)$/, '').trim())
          break
        case 'file': {
          try { await fs.access(path.resolve(root, item.path)) }
          catch { machineFailures.push({ item, reason: `file not found: ${item.path}` }) }
          break
        }
        case 'glob': {
          const hits = await findGlobHits(
            root,
            item.pattern,
            isIgnored,
            codeRootRel,
          )
          if (hits.length === 0) {
            machineFailures.push({ item, reason: `no files match: ${item.pattern}` })
          }
          break
        }
        case 'section': {
          const ok = await headingExistsInFile(root, item.file, item.heading)
          if (!ok) {
            machineFailures.push({ item, reason: `heading '${item.heading}' not found in ${item.file}` })
          }
          break
        }
        // 'unknown' already caught by PH-01 — silently skip here
      }
    }

    // E finding per machine failure
    for (const { item, reason } of machineFailures) {
      findings.push({
        id: 'PH-04', severity: 'E',
        file: 'state/phases.md',
        message: `gate: exit criterion unmet — ${reason}`,
        fix: `Satisfy the criterion: ${item.raw}`,
      })
    }

    // W finding for human checklist (always present when --gate runs and human items exist)
    if (humanItems.length > 0) {
      const checklist = humanItems.map((h, i) => `  ${i + 1}. ${h}`).join('\n')
      findings.push({
        id: 'PH-04', severity: 'W',
        file: 'state/phases.md',
        message: `gate: ${humanItems.length} human check${humanItems.length !== 1 ? 's' : ''} ${humanItems.length === 1 ? 'requires' : 'require'} sign-off before leaving '${current}'`,
        fix: `Confirm each item with the human, then update current: and run render:\n${checklist}`,
      })
    }
  }

  // ── PH-06: static exit-target validation for ALL phases (A5) ──────────────
  // file: and section: targets are statically resolvable, so validate them for
  // every phase — not only the current one under --gate. A broken target in a
  // *later* phase ("latent: trap") would otherwise stay invisible until reached.
  // glob: match-counts stay gate-only on purpose: a blank template legitimately
  // has no research*.md yet, so an empty glob is not a defect here.
  // Under --gate the current phase is already covered by PH-04 (E), so skip it
  // here to avoid a duplicate W for the same target.
  //
  // Severity grading (D-071): a future phase's exit target legitimately does
  // not exist yet — the project hasn't reached it — so an unresolvable W there
  // is not a defect, it's the normal state. Left at W it is permanently
  // unresolvable, and in a real external project that drove someone to replace
  // a checkable `section:` target with an unverifiable `(human)` one just to
  // silence the warning. Phases at or before current: still get W (the target
  // should exist by now); phases after current: are downgraded to I. Position
  // is taken from the order of the defs map (phase file order). If current:
  // itself can't be located in that order (already flagged by PH-02), grade
  // everything W rather than guess.
  const phaseOrder = [...defs.keys()]
  const currentIndex = phaseOrder.indexOf(current)
  for (const [phaseId, def] of defs) {
    if (gate && phaseId === current) continue
    const isFuture = currentIndex !== -1 && phaseOrder.indexOf(phaseId) > currentIndex
    const severity = isFuture ? 'I' : 'W'
    for (const item of parseExitItems(def.exit || '')) {
      if (item.type === 'file') {
        try { await fs.access(path.resolve(root, item.path)) }
        catch {
          findings.push({
            id: 'PH-06', severity,
            file: 'state/phases.md',
            message: isFuture
              ? `phase '${phaseId}': exit target file not due yet — '${item.path}' won't exist until this phase is reached`
              : `phase '${phaseId}': exit target file not found — ${item.path}`,
            fix: `Create '${item.path}' or fix the exit item: ${item.raw}`,
          })
        }
      } else if (item.type === 'section') {
        const ok = await headingExistsInFile(root, item.file, item.heading)
        if (!ok) {
          findings.push({
            id: 'PH-06', severity,
            file: 'state/phases.md',
            message: isFuture
              ? `phase '${phaseId}': exit target heading not due yet — '${item.heading}' won't exist in ${item.file} until this phase is reached`
              : `phase '${phaseId}': exit target heading '${item.heading}' not found in ${item.file}`,
            fix: `Add a "## ${item.heading}" heading to ${item.file} or fix the exit item: ${item.raw}`,
          })
        }
      }
      // glob: deliberately not checked here (gate-only); human/unknown skipped.
    }
  }

  return findings
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively find all non-ignored files matching globPattern.
 * The configured code-root symlink is followed; other symlinks are skipped.
 */
async function findGlobHits(
  root,
  globPattern,
  isIgnored = () => false,
  codeRootRel = null,
) {
  const re = globToRegex(globPattern)
  const hits = []
  const visited = new Set()

  async function walk(dir, relDir) {
    let realDir
    try { realDir = await fs.realpath(dir) }
    catch { return }
    if (visited.has(realDir)) return
    visited.add(realDir)

    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) }
    catch { return }

    for (const entry of entries) {
      const name = entry.name
      if (name === '.git' || name === '.truss' || name === 'node_modules') continue

      const relPath = relDir ? `${relDir}/${name}` : name
      const absPath = path.join(dir, name)
      let isDir = entry.isDirectory()
      if (entry.isSymbolicLink() && relPath === codeRootRel) {
        try { isDir = (await fs.stat(absPath)).isDirectory() }
        catch { isDir = false }
      }
      if (isIgnored(relPath, isDir)) continue

      if (isDir) {
        await walk(absPath, relPath)
      } else if (re.test(relPath)) {
        hits.push(absPath)
      }
    }
  }

  await walk(root, '')
  return hits
}

async function changedPathEvidence(root, globs, isIgnored, codeRootRel = null) {
  const codePrefix = codeRootRel ? `${codeRootRel}/` : null
  const rootGlobs = codePrefix
    ? globs.filter(glob => !glob.startsWith(codePrefix))
    : globs
  const codeGlobs = codePrefix
    ? globs.filter(glob => glob.startsWith(codePrefix))
    : []
  const matches = globs.map(glob => ({ glob, hits: [] }))
  const byGlob = new Map(matches.map(item => [item.glob, item]))
  const limited = []
  // The "uncommitted git paths only" caveat is inherent to git-based inspection
  // and always true — surfacing it unconditionally produced a persistent info
  // finding on every clean workspace. Collect
  // it separately so the caller only emits it when it actually qualifies a
  // PH-03 hit; genuine unavailability (`limited`) is still always reported.
  const uncommittedScopes = []

  const inspect = async (checkout, relevantGlobs, prefix = '') => {
    if (relevantGlobs.length === 0) return
    const report = await gitChangedPaths(checkout)
    if (!report.ok) {
      if (report.reason !== 'disabled' && !(report.reason === 'not-a-checkout' && prefix === codePrefix && !await pathExists(checkout))) {
        limited.push(`${prefix || 'workspace'} git changes unavailable (${report.reason})`)
      }
      return
    }

    for (const glob of relevantGlobs) {
      const re = globToRegex(glob)
      const hits = report.paths
        .map(rel => prefix + rel)
        .filter(rel => !isIgnored(rel, false) && re.test(rel))
      byGlob.get(glob).hits.push(...hits)
    }
    uncommittedScopes.push(`${prefix || 'workspace'} coverage includes uncommitted git paths only`)
  }

  await inspect(root, rootGlobs)
  if (codeRootRel) {
    await inspect(
      path.join(root, ...codeRootRel.split('/')),
      codeGlobs,
      codePrefix,
    )
  }
  return {
    matches,
    limited: [...new Set(limited)],
    uncommittedScopes: [...new Set(uncommittedScopes)],
  }
}

async function pathExists(absPath) {
  try { await fs.access(absPath); return true }
  catch { return false }
}

/**
 * Localised aliases for the standard scaffolded VISION.md headings. A seed
 * `section:` target is written in English, but a non-English workspace may
 * legitimately keep the heading in its own language (F-02). Each group lists
 * the accepted anchors; matching any one satisfies the section check, so the
 * exit gate no longer false-fails when e.g. a German project uses
 * "## Prinzipien" instead of "## Principles". Extend groups here as new seed
 * headings or languages are added.
 */
const HEADING_ALIASES = [
  ['problem', 'problemstellung'],
  ['idea', 'idee', 'loesung', 'lösung'],
  ['principles', 'prinzipien', 'grundsaetze', 'grundsätze'],
  ['constraints', 'rahmenbedingungen', 'einschraenkungen', 'einschränkungen'],
]

/** Return the set of anchors that count as equivalent to `anchor`. */
function anchorAliasSet(anchor) {
  const group = HEADING_ALIASES.find(g => g.includes(anchor))
  return group ? new Set(group) : new Set([anchor])
}

/**
 * Check if a heading (case-insensitive text match) exists in a file.
 * `section: VISION.md#Problem` → finds `## Problem` in VISION.md. Localised
 * equivalents of the standard VISION headings also match (see HEADING_ALIASES).
 */
async function headingExistsInFile(root, filePath, heading) {
  if (!filePath || !heading) return false
  const absPath = path.resolve(root, filePath)
  let content
  try { content = await fs.readFile(absPath, 'utf8') }
  catch { return false }

  const headings = parseHeadings(splitLines(content))
  const accepted = anchorAliasSet(headingToAnchor(heading))
  return headings.some(h => accepted.has(h.anchor))
}
