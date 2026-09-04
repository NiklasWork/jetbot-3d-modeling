// lib/commands/phase.mjs — `truss phase [<id>]`
//
// Human-facing, safe phase selection — the supported alternative to hand-editing
// `current:` in state/phases.md and remembering to re-render.
//
//   truss phase           → list the defined phases, mark the current one.
//   truss phase <id>      → validate <id> against state/phases.md, rewrite the
//                           `current:` frontmatter line, and re-render the
//                           AGENTS.md phase block so the two never drift.
//
// A transition runs the active phase's PH-04 gate first. Uncleared machine or
// human criteria require --override-gate. This records explicit intent but does
// not authenticate that the caller is human.
//
// runPhase RETURNS a result object (testable in-process) and THROWS PhaseError on
// a fatal user error; the dispatcher maps that to a non-zero exit.

import fs from 'node:fs/promises'
import path from 'node:path'
import { parsePhases } from '../md.mjs'
import { renderPhaseBlock, renderNoPhasesBlock } from '../render.mjs'
import { writeBlock } from '../writer.mjs'
import { loadWorkspace } from '../workspace.mjs'
import { writeFileAtomic } from '../scaffold.mjs'
import * as phaseChecks from '../../checks/ph.mjs'

export class PhaseError extends Error {}

/** Replace the `current:` line inside the leading `---` frontmatter block. */
export function setCurrentInFrontmatter(raw, id) {
  const lines = raw.split('\n')
  if (lines[0]?.trim() !== '---') throw new PhaseError('phase: state/phases.md has no leading frontmatter block')
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') break // end of frontmatter without a current: line
    if (/^current:\s*/.test(lines[i])) {
      lines[i] = `current: ${id}`
      return lines.join('\n')
    }
  }
  throw new PhaseError('phase: no `current:` line found in state/phases.md frontmatter')
}

/**
 * @param {string}   root  Absolute workspace root.
 * @param {string[]} argv  Arguments after "phase" (argv[0] = target id, optional).
 * @returns {Promise<object>} Result summary (also printed). Throws PhaseError on fatal error.
 */
export async function runPhase(root, argv) {
  const overrideGate = argv.includes('--override-gate')
  const positional = argv.filter(arg => !arg.startsWith('--'))
  const unknownFlags = argv.filter(arg => arg.startsWith('--') && arg !== '--override-gate')
  if (unknownFlags.length > 0 || positional.length > 1) {
    throw new PhaseError("phase: usage: phase [<id>] [--override-gate]")
  }
  const target = positional[0]
  const phasesPath = path.join(root, 'state', 'phases.md')

  let raw
  try { raw = await fs.readFile(phasesPath, 'utf8') }
  catch (readErr) {
    // Absent is not broken (U4) — but "there and unreadable" IS broken, and the
    // read error is the only place that still knows which one happened. Only
    // ENOENT means the workspace deliberately has no phase model; anything else
    // (permissions, a directory, an I/O error) stays fatal, so a chmod can never
    // quietly convert a gated workspace into an ungated one.
    if (readErr?.code !== 'ENOENT') {
      throw new PhaseError(`phase: state/phases.md exists but could not be read (${readErr.code ?? readErr.message}) — fix it, or remove it to run without a phase model.`)
    }
    // A workspace without state/phases.md runs without a phase model.
    // Report it and exit clean instead of failing —
    // and converge the AGENTS.md block on the same canonical notice `render`
    // writes, so the boot file never advertises gates that do not exist.
    // The text lives once in lib/render.mjs; a second copy here would drift
    // and produce the BL-02 error this path exists to avoid.
    let blockNote = ''
    try {
      await writeBlock(path.join(root, 'AGENTS.md'), 'phase', renderNoPhasesBlock())
    } catch (err) {
      blockNote = `\n  Note: the AGENTS.md phase block could not be updated (${err.message}).`
    }
    console.log(
      'truss phase: no state/phases.md — this workspace runs without a phase model.\n' +
      '  No gates, no forbidden lists, no exit criteria. To enable phases, add\n' +
      '  state/phases.md (e.g. from .truss/phase-profiles/) and run `truss render`.' +
      blockNote
    )
    return { noPhases: true }
  }

  const { ordered, defs, frontmatter } = parsePhases(raw.split('\n'))
  const currentId = frontmatter?.current

  // No argument → list and exit (read-only).
  if (!target) {
    const L = ['', `Current phase: ${currentId ?? '(none)'}`, '', '  Defined phases:']
    ordered.forEach((id, i) => {
      const d = defs.get(id)
      const mark = id === currentId ? '→' : ' '
      L.push(`   ${mark} ${i + 1}. ${id}${d?.label ? ` — ${d.label}` : ''}`)
    })
    L.push('', '  Set with: node .truss/bin/truss.mjs phase <id>', '')
    console.log(L.join('\n'))
    return { listed: true, current: currentId, ordered }
  }

  if (!defs.has(target)) {
    throw new PhaseError(`phase: '${target}' is not a defined phase. Known: ${ordered.join(', ')}`)
  }
  if (target === currentId) {
    console.log(`truss phase: already on '${target}' — nothing to change.`)
    return { changed: false, current: currentId }
  }

  const gateCtx = await loadWorkspace(root)
  gateCtx.gate = true
  const gateFindings = (await phaseChecks.run(gateCtx)).filter(f => f.id === 'PH-04')
  if (gateFindings.length > 0 && !overrideGate) {
    const details = gateFindings.map(f => `       - ${f.message}`).join('\n')
    throw new PhaseError(
      `phase: exit gate for '${currentId}' is not cleared:\n${details}\n` +
      "       A human may confirm or override these results with --override-gate."
    )
  }

  // Write the new current:, then re-render the AGENTS.md phase block. Render
  // through loadWorkspace (identical to `truss render` and the BL-02 drift
  // check) so the written block is byte-identical to the canonical render.
  const agentsPath = path.join(root, 'AGENTS.md')
  const agentsRaw = await fs.readFile(agentsPath, 'utf8')
  await writeFileAtomic(phasesPath, setCurrentInFrontmatter(raw, target))
  let cp
  try {
    const ctx = await loadWorkspace(root)
    cp = ctx.phases
    const def = cp.defs.get(target)
    const pos = cp.ordered.indexOf(target) + 1
    const total = cp.ordered.length
    await writeBlock(agentsPath, 'phase', renderPhaseBlock(def, target, pos, total))
  } catch (err) {
    const rollbackErrors = []
    try { await writeFileAtomic(phasesPath, raw) }
    catch (rollbackErr) { rollbackErrors.push(`state/phases.md: ${rollbackErr.message}`) }
    try { await writeFileAtomic(agentsPath, agentsRaw) }
    catch (rollbackErr) { rollbackErrors.push(`AGENTS.md: ${rollbackErr.message}`) }
    const rollbackMessage = rollbackErrors.length === 0
      ? 'transition was rolled back'
      : `rollback was incomplete (${rollbackErrors.join('; ')})`
    throw new PhaseError(`phase: render failed; ${rollbackMessage}: ${err.message}`)
  }

  const pos = cp.ordered.indexOf(target) + 1
  const total = cp.ordered.length
  console.log(`truss phase: ${currentId ?? '(none)'} → ${target} (${pos}/${total}) — AGENTS.md re-rendered.`)
  console.log(`  Gate: ${gateFindings.length === 0 ? 'passed mechanically' : 'overridden by explicit human action'}.`)
  return { changed: true, from: currentId, current: target, position: pos, total, gateOverridden: gateFindings.length > 0 }
}
