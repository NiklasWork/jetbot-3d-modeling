// lib/run-checks.mjs — run every check family, in exactly one place.
//
// The list of check families used to live inline in `runDoctor` (bin/truss.mjs).
// It stayed correct only as long as `doctor` was the sole caller; the moment
// `truss status` needed the same answer, a second copy of the list would have
// been a list that can silently disagree with the first — the pattern L-006
// names and D-079 removed for the ID classes. So the loader, the registry, the
// per-module error trapping, the sort and the dedupe live here, and both
// commands import them.
//
// Pure orchestration: no I/O of its own, no output, no process.exit. The caller
// decides what to print and what exit code to use.

import { SEV_ORDER, dedupeFindings } from './severity.mjs'
import { applySuppressions } from './suppress.mjs'

/**
 * The check families, in catalog order. Adding a family means adding it here —
 * the one place, which is the whole point of this module.
 */
export const CHECK_MODULES = ['st', 'bl', 'rf', 'ph', 'sy', 'cx']

/**
 * Load and run every check against a loaded workspace context.
 *
 * A module that fails to LOAD and a check that THROWS both become an INTERNAL
 * error finding rather than taking the run down — a broken check must not be
 * able to hide the findings of the healthy ones.
 *
 * @param {import('./workspace.mjs').WorkspaceContext} ctx  loaded workspace;
 *        set `ctx.gate = true` before calling for gate semantics (PH-04 reads it).
 * @returns {Promise<{
 *   registry: Array<{id:string, severity:string, title:string, description?:string}>,
 *   findings: Array<object>,   // deduped, sorted E → W → I then file/line
 *   occurrenceTotal: number,   // raw findings before dedupe
 *   errors: Array<object>, warnings: Array<object>, infos: Array<object>,
 *   exitCode: 0|1|2,
 * }>}
 */
export async function runAllChecks(ctx) {
  const settled = await Promise.allSettled(
    CHECK_MODULES.map(name => import(`../checks/${name}.mjs`))
  )
  const modules = settled.filter(r => r.status === 'fulfilled').map(r => r.value)

  // Declarative check registry (A2): the full catalog, gathered from each
  // module's `meta` export, so consumers can enumerate ALL checks — not only
  // the ones that fired this run.
  const registry = modules.flatMap(mod => mod.meta ?? [])

  const allFindings = []
  for (const err of settled.filter(r => r.status === 'rejected').map(r => r.reason)) {
    allFindings.push({
      id: 'INTERNAL', severity: 'E',
      file: '(check loader)',
      message: `Failed to load check module: ${err?.message || String(err)}`,
      fix: 'Check the module file for syntax errors or invalid imports.',
    })
  }

  const results = await Promise.all(modules.map(async mod => {
    try {
      return await mod.run(ctx)
    } catch (err) {
      return [{
        id: 'INTERNAL', severity: 'E',
        file: '(check runner)',
        message: `check threw an unexpected error: ${err?.message || String(err)}`,
        fix: 'Report this as a truss bug — include the stack trace from stderr',
      }]
    }
  }))
  allFindings.push(...results.flat())

  // A file may silence one info finding about itself, with a reason written in
  // it (lib/suppress.mjs). Applied here, in the one place every family's
  // findings pass through, so no check has to know the mechanism exists.
  //
  // BEFORE dedupe, deliberately. Dedupe collapses N occurrences into one
  // representative that carries only the FIRST location, so suppressing
  // afterwards would either drop every occurrence because the representative's
  // file happened to carry a marker, or keep them all because it did not. Per
  // occurrence, each finding is still attributed to the file it is about.
  const { kept, suppressed, unapplied } = applySuppressions(allFindings, ctx)
  allFindings.length = 0
  allFindings.push(...kept)

  allFindings.sort((a, b) =>
    ((SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)) ||
    (a.file || '').localeCompare(b.file || '') ||
    ((a.line || 0) - (b.line || 0))
  )

  const findings = dedupeFindings(allFindings)
  const errors   = findings.filter(f => f.severity === 'E')
  const warnings = findings.filter(f => f.severity === 'W')
  const infos    = findings.filter(f => f.severity === 'I')

  return {
    registry,
    findings,
    occurrenceTotal: allFindings.length,
    // Silenced, not gone: the caller reports the count, so a workspace can never
    // quietly accumulate suppressions nobody remembers making.
    suppressed,
    // Markers that matched several findings and therefore silenced none. A
    // marker that does nothing has to say so, or it is just a line somebody
    // wrote once and now believes in.
    unapplied,
    errors, warnings, infos,
    exitCode: errors.length > 0 ? 2 : warnings.length > 0 ? 1 : 0,
  }
}
