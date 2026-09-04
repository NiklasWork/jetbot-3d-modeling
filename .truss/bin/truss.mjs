#!/usr/bin/env node
// .truss/bin/truss.mjs — Truss CLI dispatcher
// Node >= 20, ESM, zero external dependencies.
// Usage: node .truss/bin/truss.mjs <command> [flags]

// ── Node version guard (must use CJS-safe syntax to run on older Nodes) ──────
const _maj = parseInt(process.versions.node.split('.')[0], 10)
if (_maj < 20) {
  process.stderr.write(
    `Truss requires Node >= 20 (found: v${process.versions.node}).\n` +
    `Please update Node.js: https://nodejs.org/\n`
  )
  process.exit(1)
}
//
// M2: doctor (ST/BL/RF checks) + --fix-prompt + --json + exit codes
// M3: render, set, --gate, PH checks
// M4: init (workspace scaffolding)
// M5: SY/CX checks, doctor --html

import path from 'node:path'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { loadWorkspace, resolveRoot } from '../lib/workspace.mjs'
import { renderPhaseBlock, renderNoPhasesBlock, renderPrefsBlock, parsePrefsRows } from '../lib/render.mjs'
import { writeBlock } from '../lib/writer.mjs'
import { PREFS_CATALOG, CATALOG_KEYS, FREE_VALUE_KEYS, isValidFreeValue, isOmitValue, RETIRED_KEYS } from '../lib/prefs.mjs'
import { loadBehaviorText } from '../lib/defaults.mjs'
import { runInit } from '../lib/commands/init.mjs'
import { runUpgrade } from '../lib/commands/upgrade.mjs'
import { runMap } from '../lib/commands/map.mjs'
import { runStatus } from '../lib/commands/status.mjs'
import { runPhase } from '../lib/commands/phase.mjs'
import { runSkills } from '../lib/commands/skills.mjs'
import { COMMAND_META, COMMAND_BY_NAME, inspectArgs } from '../lib/command-meta.mjs'
import { SEV_ORDER, SEV_LABEL, FAMILY_NAMES, col, dedupeFindings } from '../lib/severity.mjs'

const root = resolveRoot(import.meta.url)
const agentsMdPath = path.join(root, 'AGENTS.md')

const [,, command, ...args] = process.argv

// ── Helpers ───────────────────────────────────────────────────────────────────
function getVersion() {
  try { return readFileSync(path.join(root, '.truss', 'VERSION'), 'utf8').trim() }
  catch { return '?' }
}

// ── HTML report ─────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Render the doctor report as a self-contained dark-theme HTML page (GE-14:
 * zero dependencies, no CDN, no build). Lists every finding plus the full check
 * catalog (all families ST/BL/RF/SY/PH/CX) with a fired-count per check.
 */
function renderHtmlReport({ root, version, timestamp, gate, summary, registry, findings }) {
  const ts = timestamp.replace('T', ' ').slice(0, 16) + ' UTC'
  const projectName = root.split('/').filter(Boolean).pop() || root
  const status =
    summary.errors   > 0 ? { cls: 'err',  text: `${summary.errors} error${summary.errors   !== 1 ? 's' : ''} — fix before proceeding` } :
    summary.warnings > 0 ? { cls: 'warn', text: `${summary.warnings} warning${summary.warnings !== 1 ? 's' : ''}` } :
                           { cls: 'ok',   text: 'All checks passed' }

  const findingRows = findings.length === 0
    ? `<tr><td colspan="4" class="muted center">No findings — workspace is clean.</td></tr>`
    : findings.map(f => {
        const loc = f.line ? `${f.file}:${f.line}` : (f.file || '')
        const occ = f.occurrences > 1 ? ` <span class="muted">(×${f.occurrences})</span>` : ''
        return `      <tr>
        <td><span class="sev sev-${f.severity}">${SEV_LABEL[f.severity] || f.severity}</span></td>
        <td class="mono">${escapeHtml(f.id)}</td>
        <td class="mono">${escapeHtml(loc)}</td>
        <td>${escapeHtml(f.message)}${occ}${f.fix ? `<div class="fix">${escapeHtml(f.fix)}</div>` : ''}</td>
      </tr>`
      }).join('\n')

  const firedById = new Map()
  const firedSevById = new Map()   // highest actual severity a check fired (PH-04/CX-01 can escalate past their nominal severity)
  const SEV_RANK = { I: 0, W: 1, E: 2 }
  for (const f of findings) {
    firedById.set(f.id, (firedById.get(f.id) || 0) + (f.occurrences || 1))
    const prev = firedSevById.get(f.id)
    if (prev === undefined || SEV_RANK[f.severity] > SEV_RANK[prev]) firedSevById.set(f.id, f.severity)
  }

  const families = new Map()
  for (const c of registry) {
    const fam = c.id.split('-')[0]
    if (!families.has(fam)) families.set(fam, [])
    families.get(fam).push(c)
  }
  const catalogRows = [...families.entries()].map(([fam, checks]) => {
    const head = `      <tr class="fam"><td colspan="4">${fam} — ${FAMILY_NAMES[fam] || fam}</td></tr>`
    const rows = checks.map(c => {
      const fired = firedById.get(c.id) || 0
      const firedSev = firedSevById.get(c.id) || c.severity
      const badge = fired > 0 ? `<span class="sev sev-${firedSev}">${fired}</span>` : `<span class="muted">—</span>`
      return `      <tr>
        <td class="mono">${escapeHtml(c.id)}</td>
        <td class="mono muted">${escapeHtml(c.severity)}</td>
        <td>${escapeHtml(c.title)}</td>
        <td class="center">${badge}</td>
      </tr>`
    }).join('\n')
    return `${head}\n${rows}`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>truss doctor — ${escapeHtml(projectName)}</title>
<style>
  :root { --bg:#0f1117; --surface:#1a1d27; --border:#2a2d3a; --text:#e2e4ed;
    --muted:#6b7080; --accent:#6c8fff; --error:#ff6b6b; --warning:#ffa94d; --ok:#69db7c; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font:14px/1.55 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
  .wrap { max-width:960px; margin:0 auto; padding:32px 20px 64px; }
  h1 { font-size:18px; margin:0 0 2px; font-weight:600; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:32px 0 10px; }
  .sub { color:var(--muted); font-size:13px; }
  .banner { margin:20px 0 6px; padding:12px 16px; border-radius:8px; border:1px solid var(--border);
    background:var(--surface); font-weight:600; }
  .banner.ok { color:var(--ok); border-color:#2c4a36; }
  .banner.warn { color:var(--warning); border-color:#4a3c24; }
  .banner.err { color:var(--error); border-color:#4a2c2c; }
  .counts { display:flex; gap:10px; margin:14px 0 4px; flex-wrap:wrap; }
  .chip { background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:6px 12px; font-size:13px; }
  table { width:100%; border-collapse:collapse; background:var(--surface); border:1px solid var(--border);
    border-radius:8px; overflow:hidden; }
  th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  tr:last-child td { border-bottom:none; }
  .center { text-align:center; }
  .muted { color:var(--muted); }
  .fix { color:var(--muted); font-size:12.5px; margin-top:4px; }
  .sev { display:inline-block; min-width:58px; text-align:center; padding:2px 8px; border-radius:5px; font-size:12px; font-weight:700; }
  .sev-E { background:rgba(255,107,107,.16); color:var(--error); }
  .sev-W { background:rgba(255,169,77,.16); color:var(--warning); }
  .sev-I { background:rgba(108,143,255,.16); color:var(--accent); }
  tr.fam td { background:#13161f; font-weight:700; }
  footer { color:var(--muted); font-size:12px; margin-top:36px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>truss doctor${gate ? ' --gate' : ''}</h1>
  <div class="sub">${escapeHtml(projectName)} · truss ${escapeHtml(version)} · ${escapeHtml(ts)}</div>

  <div class="banner ${status.cls}">${status.text}</div>

  <div class="counts">
    <span class="chip"><b style="color:var(--error)">${summary.errors}</b> errors</span>
    <span class="chip"><b style="color:var(--warning)">${summary.warnings}</b> warnings</span>
    <span class="chip"><b style="color:var(--accent)">${summary.infos}</b> info</span>
    <span class="chip"><b>${summary.total}</b> total</span>
  </div>

  <h2>Findings</h2>
  <table>
    <thead><tr><th>Severity</th><th>Check</th><th>Location</th><th>Message &amp; fix</th></tr></thead>
    <tbody>
${findingRows}
    </tbody>
  </table>

  <h2>Check catalog</h2>
  <table>
    <thead><tr><th>ID</th><th>Sev</th><th>What it checks</th><th>Fired</th></tr></thead>
    <tbody>
${catalogRows}
    </tbody>
  </table>

  <footer>Generated by <span class="mono">truss doctor --html</span> — static snapshot, no auto-refresh. Re-run to update.</footer>
</div>
</body>
</html>
`
}

// ── Help ──────────────────────────────────────────────────────────────────────
function showHelp() {
  // Commands list is generated from the single command-meta source (COMMAND_META),
  // so help can never drift from what the dispatcher actually handles.
  const commandLines = COMMAND_META
    .map(c => `  ${c.display.padEnd(17)} ${c.summary}`)
    .join('\n')
  console.log(`truss ${getVersion()} — workspace health and state management
Workspace: ${root}

Commands:
${commandLines}

Init flags:
  --name <name>     project name (skips the interactive prompt)
  --lang <lang>     primary language for agent output (e.g. English)
  --overlay         existing-project mode: ingest→operate phases, .gitignore repo/
  --code-root <dir> select one existing in-workspace code root (overlay only)
  --skills <groups> none (default), all, or comma-separated baseline groups
  --no-phases       scaffold without state/phases.md (no gates, no exit criteria)

Doctor flags:
  --gate        also run PH-04 phase-exit checks
  --html        write report as HTML to .truss/out/doctor.html
  --json        write report as JSON to .truss/out/doctor.json
  --fix-prompt  output a copyable remediation prompt for all findings

Exit codes: 0 = clean · 1 = warnings only · 2 = errors present
`)
}

// Per-command help. Derived from the same COMMAND_META entry the argument gate
// validates against, so the two can never disagree about what a command accepts.
function showCommandHelp(meta) {
  const flags = Object.entries(meta.flags)
  const lines = flags.length
    ? flags.map(([name, spec]) => `  ${spec.value ? `${name} <value>` : name}`).join('\n')
    : '  (none)'
  console.log(`truss ${meta.display}
  ${meta.summary}

Flags:
${lines}

Run 'node .truss/bin/truss.mjs help' for the full command list.
`)
}

// ── doctor ────────────────────────────────────────────────────────────────────
async function runDoctor(flags) {
  const wantJson      = flags.includes('--json')
  const wantFixPrompt = flags.includes('--fix-prompt')
  const wantHtml      = flags.includes('--html')
  const gate          = flags.includes('--gate')

  let ctx
  try {
    ctx = await loadWorkspace(root)
  } catch (err) {
    console.error(`truss doctor: failed to load workspace — ${err.message}`)
    process.exit(2)
  }

  ctx.gate = gate  // PH-04 reads this

  // ── Init guard ──────────────────────────────────────────────────────────
  // If AGENTS.md doesn't exist the workspace is uninitialised.  Instead of
  // running all checks (which would produce ~10 confusing errors) we emit a
  // single, friendly message and exit 0.
  if (ctx.agentsMissing) {
    const msg = 'This folder is not a Truss workspace yet. Start with:\n\n'
      + '  node .truss/bin/truss.mjs init\n\n'
      + '  For an existing project, use:  node .truss/bin/truss.mjs init --overlay'

    if (wantJson) {
      const report = { initialized: false, message: msg, timestamp: new Date().toISOString(), root, version: getVersion() }
      const outDir  = path.join(root, '.truss', 'out')
      const outFile = path.join(outDir, 'doctor.json')
      await fs.mkdir(outDir, { recursive: true })
      await fs.writeFile(outFile, JSON.stringify(report, null, 2), 'utf8')
      console.error('Report written to .truss/out/doctor.json')
      process.exit(0)
    }
    if (wantHtml) {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>truss doctor</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:60px auto;color:#333}
.box{border:2px solid #6c8;border-radius:8px;padding:24px 28px;background:#f6fff6}
code{background:#eee;padding:2px 6px;border-radius:4px;font-size:14px}</style></head>
<body><div class="box"><h2>Workspace not initialised</h2>
<p>${msg.replace(/\n/g, '<br>')}</p></div></body></html>`
      const outDir  = path.join(root, '.truss', 'out')
      const outFile = path.join(outDir, 'doctor.html')
      await fs.mkdir(outDir, { recursive: true })
      await fs.writeFile(outFile, html, 'utf8')
      console.error('Report written to .truss/out/doctor.html')
      process.exit(0)
    }
    if (wantFixPrompt) {
      console.log('This folder is not a Truss workspace yet. Run `truss init` to get started.')
      process.exit(0)
    }
    // Human-readable default
    console.log(`\n${msg}\n`)
    process.exit(0)
  }

  const loadTasks = [
    import('../checks/st.mjs'),
    import('../checks/bl.mjs'),
    import('../checks/rf.mjs'),
    import('../checks/ph.mjs'),
    import('../checks/sy.mjs'),
    import('../checks/cx.mjs'),
  ]

  // All core check modules run in parallel; no first-fail
  const settled = await Promise.allSettled(loadTasks)
  const modules = settled.filter(r => r.status === 'fulfilled').map(r => r.value)

  // Declarative check registry (A2): the full catalog of checks, gathered from
  // each module's `meta` export. Lets --json consumers enumerate ALL checks,
  // not only the ones that fired this run.
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

  // Run all module checks in parallel
  const runTasks = modules.map(async mod => {
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
  })
  
  const results = await Promise.all(runTasks)
  allFindings.push(...results.flat())

  // Sort: E → W → I, then by file+line
  allFindings.sort((a, b) =>
    ((SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)) ||
    (a.file || '').localeCompare(b.file || '') ||
    ((a.line || 0) - (b.line || 0))
  )

  // Collapse identical (id + message) findings so one cause surfaces once with an
  // occurrence count, instead of N duplicate rows burying the actionable ones.
  const findings = dedupeFindings(allFindings)
  const occurrenceTotal = allFindings.length

  const errors   = findings.filter(f => f.severity === 'E')
  const warnings = findings.filter(f => f.severity === 'W')
  const infos    = findings.filter(f => f.severity === 'I')
  const exitCode = errors.length > 0 ? 2 : warnings.length > 0 ? 1 : 0

  // ── JSON output ─────────────────────────────────────────────────────────
  if (wantJson) {
    const report = {
      initialized: true,       // reached only past the agentsMissing guard → workspace exists.
                               // Stamped so a fresh doctor run self-heals a stale uninit report.
      timestamp: new Date().toISOString(),
      root,
      version: getVersion(),
      gate,
      summary: { errors: errors.length, warnings: warnings.length, infos: infos.length, total: findings.length, occurrences: occurrenceTotal },
      scan: ctx.ignore,        // { sources: [...], excluded: n } — what the ignore layer dropped
      checks: registry,        // full catalog of all checks (A2), independent of what fired
      findings,                // deduped: each carries occurrences + locations
    }
    const outDir  = path.join(root, '.truss', 'out')
    const outFile = path.join(outDir, 'doctor.json')
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(outFile, JSON.stringify(report, null, 2), 'utf8')
    console.error('Report written to .truss/out/doctor.json')
  }

  // ── HTML output ────────────────────────────────────────────────────────────
  if (wantHtml) {
    const html = renderHtmlReport({
      root, version: getVersion(), timestamp: new Date().toISOString(), gate,
      summary: { errors: errors.length, warnings: warnings.length, infos: infos.length, total: findings.length },
      registry, findings,
    })
    const outDir  = path.join(root, '.truss', 'out')
    const outFile = path.join(outDir, 'doctor.html')
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(outFile, html, 'utf8')
    console.error('Report written to .truss/out/doctor.html')
  }

  // ── Fix-prompt output ────────────────────────────────────────────────────
  if (wantFixPrompt) {
    if (findings.length === 0) {
      console.log('No findings — nothing to fix.')
    } else {
      const lines = [
        'Fix the following truss findings exactly as described below.',
        'Do not change anything else.',
        'After fixing, run:  node .truss/bin/truss.mjs doctor',
        '',
      ]
      for (const f of findings) {
        const loc = f.line ? `${f.file}:${f.line}` : (f.file || '')
        const occ = f.occurrences > 1 ? `  (×${f.occurrences})` : ''
        lines.push(`${f.severity}  ${f.id}  ${loc}${occ}`)
        lines.push(`  Problem: ${f.message}`)
        lines.push(`  Fix:     ${f.fix}`)
        lines.push('')
      }
      console.log(lines.join('\n'))
    }
    process.exit(exitCode)
  }

  // JSON/HTML report modes are non-interactive: exit once the file(s) are written.
  if (wantJson || wantHtml) process.exit(exitCode)

  // ── Human-readable output ────────────────────────────────────────────────
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16)
  const gateLabel = gate ? ' --gate' : ''
  console.log(`\ntruss doctor${gateLabel} — ${now}\n`)

  if (findings.length === 0) {
    console.log('  ✓  All checks passed.\n')
  } else {
    for (const f of findings) {
      const loc = f.line ? `${f.file}:${f.line}` : (f.file || '')
      const occ = f.occurrences > 1 ? `  (×${f.occurrences})` : ''
      console.log(
        `  ${col(f.severity, f.severity)}  ` +
        `${col(f.severity, f.id.padEnd(8))}  ` +
        `${loc.padEnd(38)}  ` +
        `${f.message}${occ}`
      )
    }
    console.log('')
  }

  // Visible scan report: exclusion is never silent (the user must be able to see
  // that .trussignore/.gitignore dropped paths, and how many).
  if (ctx.ignore?.excluded > 0) {
    const via = ctx.ignore.sources.length ? ` via ${ctx.ignore.sources.join(', ')}` : ''
    console.log(`  ${ctx.ignore.excluded} path${ctx.ignore.excluded !== 1 ? 's' : ''} excluded from scan${via}.\n`)
  }

  const parts = []
  if (errors.length)   parts.push(col('E', `${errors.length} error${errors.length !== 1 ? 's' : ''}`))
  if (warnings.length) parts.push(col('W', `${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`))
  if (infos.length)    parts.push(col('I', `${infos.length} info`))
  const occNote = occurrenceTotal > findings.length ? ` across ${occurrenceTotal} occurrences` : ''
  console.log(
    parts.length
      ? `  ${findings.length} finding${findings.length !== 1 ? 's' : ''}${occNote} (${parts.join(', ')})\n`
      : '  0 findings\n'
  )
  if (errors.length > 0) console.log('  Run with --fix-prompt for a copyable remediation prompt.\n')

  process.exit(exitCode)
}

// ── render ────────────────────────────────────────────────────────────────────
// ── ack ─────────────────────────────────────────────────────────────────────
// `truss ack context [--note "..."] [--clear]` — record that the boot context
// was read through and judged lean at its current size. Rationale for the whole
// mechanism (and why it is not a commit counter or a timer) lives in
// lib/context-ack.mjs. This command only measures and writes; the judgement is
// the human's, which is exactly why it is a deliberate command and not something
// doctor can do to itself.
async function runAck(args) {
  const target = args[0]
  if (target !== 'context') {
    console.error(`truss ack: unknown target '${target ?? ''}'. Usage: truss ack context [--note "…"] [--clear]`)
    process.exit(1)
  }

  const { writeContextAck, clearContextAck, ACK_HEADROOM, ACK_REL_PATH } = await import('../lib/context-ack.mjs')

  if (args.includes('--clear')) {
    const result = await clearContextAck(root)
    if (result === 'removed') {
      console.log('truss ack: context baseline cleared — CX-01 reports at full severity again.')
    } else if (result === 'absent') {
      console.log('truss ack: no context baseline was recorded.')
    } else {
      // Never report a failed delete as "nothing to clear": the baseline would
      // still be silencing the warning while the human believes it is gone.
      console.error(`truss ack: could not remove ${ACK_REL_PATH} — the baseline is STILL in effect. Delete the file manually.`)
      process.exit(2)
    }
    return
  }

  // Measure with the SAME code path the check uses, so the recorded baseline and
  // the number CX-01 judges can never be computed differently.
  const { CONTEXT_FILES, wordCount, toTokens, phaseReadTargets, WARN_TOKENS, ERROR_TOKENS } = await import('../lib/context-budget.mjs')
  const ctx = await loadWorkspace(root)

  let words = 0
  const seen = new Set()
  const addRel = async (rel) => {
    if (seen.has(rel)) return
    seen.add(rel)
    const f = ctx.files.get(rel)
    if (f) { words += wordCount(f.content); return }
    try { words += wordCount(await fs.readFile(path.join(root, rel), 'utf8')) } catch { /* missing — ignore */ }
  }
  for (const rel of CONTEXT_FILES) await addRel(rel)
  for (const rel of phaseReadTargets(ctx.phases)) await addRel(rel)

  const tokens = toTokens(words)

  if (tokens < WARN_TOKENS) {
    console.log(`truss ack: boot context ≈ ${tokens} tokens — already under the ${WARN_TOKENS} warn threshold, nothing to acknowledge.`)
    return
  }
  if (tokens >= ERROR_TOKENS) {
    console.error(`truss ack: boot context ≈ ${tokens} tokens is at or above the ${ERROR_TOKENS} error band — an ack does not silence an error. Trim it first (\`cleanup\` prompt).`)
    process.exit(1)
  }

  const noteIdx = args.indexOf('--note')
  const note = noteIdx >= 0 && args.length > noteIdx + 1 ? args[noteIdx + 1] : undefined

  const entry = await writeContextAck(root, 'CX-01', { tokens, note })
  const ceiling = Math.round(tokens * (1 + ACK_HEADROOM))
  console.log(`truss ack: boot context reviewed at ≈ ${entry.tokens} tokens (${entry.date}).`)
  console.log(`  CX-01 reports as info until it grows past ≈ ${ceiling}; the error band still fires unconditionally.`)
  console.log(`  Recorded in .truss/out/context-ack.json (gitignored — local to this checkout).`)
}

// `render` has two generated targets: the AGENTS.md phase block and the decision
// index. The phase block goes first because it is the command's headline job and
// the one with the fatal paths; the index is written afterwards so a phase
// problem never leaves a half-rendered workspace behind it.
async function runRender() {
  let ctx
  try {
    ctx = await loadWorkspace(root)
  } catch (err) {
    console.error(`truss render: failed to load workspace — ${err.message}`)
    process.exit(2)
  }

  await renderPhaseInto(ctx)
  await renderDecisionsIndex()
}

// state/decisions-index.md — the boot-sized index of the decision log (D-075, D-087).
// No log at all is not an error: nothing to index, nothing to say beyond a note.
async function renderDecisionsIndex() {
  const { writeIndex, INDEX_REL, SOURCE_REL, DECISIONS_DIR } = await import('../lib/decisions-index.mjs')
  let result
  try {
    result = await writeIndex(root)
  } catch (err) {
    console.error(`truss render: failed to write ${INDEX_REL} — ${err.message}`)
    process.exit(2)
  }
  if (result === null) {
    console.log(`truss render: no decision log (${DECISIONS_DIR}/ or ${SOURCE_REL}) — index not written.`)
    return
  }
  const from = result.form === 'dir' ? `${DECISIONS_DIR}/` : SOURCE_REL
  console.log(`truss render: ${INDEX_REL} updated (${result.entries} decision${result.entries === 1 ? '' : 's'} from ${from}).`)
}

async function renderPhaseInto(ctx) {
  const { phases } = ctx

  // Absent is not broken (U4): no state/phases.md means the workspace runs
  // without a phase model. That is a supported configuration, so render writes
  // the canonical notice and exits clean instead of failing.
  //
  // `phases.stat` is attached by lib/workspace.mjs only when the file was
  // actually READ, so it does not by itself separate "deleted" from "there but
  // unreadable". Render WRITES, so the difference matters most here: silently
  // replacing a live phase block with the no-phases notice because of a
  // permissions glitch would strip a workspace of its gates and still exit 0.
  // Stat the path to tell the two apart; a present-but-unreadable file keeps
  // the old fatal path and the block is left untouched. A file that is readable
  // but empty or malformed never reaches here — it falls through below, and
  // PH-05 flags it.
  if (!phases.stat) {
    let phasesPresent = false
    try { await fs.stat(path.join(root, 'state', 'phases.md')); phasesPresent = true } catch {}
    if (phasesPresent) {
      console.error('truss render: state/phases.md exists but could not be read — the phase block was left unchanged.')
      console.error('  Make it a readable UTF-8 file, or remove it to run this workspace without a phase model.')
      process.exit(2)
    }
    try {
      await writeBlock(agentsMdPath, 'phase', renderNoPhasesBlock())
    } catch (err) {
      console.error(`truss render: failed to write block — ${err.message}`)
      process.exit(2)
    }
    console.log('truss render: no state/phases.md — phase block set to the no-phases notice.')
    console.log('  Add state/phases.md (e.g. from .truss/phase-profiles/) and re-run to enable phases.')
    return
  }

  const { ordered, defs, frontmatter } = phases
  const currentId = frontmatter?.current

  if (!currentId || !defs.has(currentId)) {
    const known = [...defs.keys()].join(', ')
    console.error(`truss render: current phase '${currentId}' not found in phases.md (defined: ${known})`)
    process.exit(2)
  }

  const phaseDef = defs.get(currentId)
  const position = ordered.indexOf(currentId) + 1
  const total    = ordered.length
  const lines    = renderPhaseBlock(phaseDef, currentId, position, total)

  try {
    await writeBlock(agentsMdPath, 'phase', lines)
    console.log(`truss render: phase block updated (${currentId}, ${position}/${total})`)
  } catch (err) {
    console.error(`truss render: failed to write block — ${err.message}`)
    process.exit(2)
  }
}

// ── set ───────────────────────────────────────────────────────────────────────
async function runSet(keyArg, valueArg) {
  if (!keyArg || !valueArg) {
    console.error('Usage: truss set <key> <value>')
    console.error(`Known keys: ${PREFS_CATALOG.map(e => e.key).join(', ')}`)
    process.exit(1)
  }

  // Validate key
  if (!CATALOG_KEYS.has(keyArg)) {
    console.error(`truss set: unknown key '${keyArg}'`)
    console.error(`Known keys: ${PREFS_CATALOG.map(e => e.key).join(', ')}`)
    process.exit(1)
  }

  // Validate value
  const isFree = FREE_VALUE_KEYS.has(keyArg)
  if (isFree) {
    if (!isValidFreeValue(valueArg)) {
      console.error(`truss set: invalid value '${valueArg}' for key '${keyArg}' (expected 'off' or a short word)`)
      process.exit(1)
    }
  } else {
    const validValues = CATALOG_KEYS.get(keyArg)
    if (!validValues.has(valueArg)) {
      console.error(`truss set: invalid value '${valueArg}' for key '${keyArg}'`)
      console.error(`Valid values: ${[...validValues].join(', ')}`)
      process.exit(1)
    }
  }

  // Omit-values (e.g. scope=off) write no directive at all — skip the
  // behavior lookup entirely; the row is dropped below.
  const omit = isOmitValue(keyArg, valueArg)

  // Behavior text. Free-value keys with a custom value generate it dynamically;
  // everything else (incl. control-word 'off') reads the shared template loader.
  let behaviorText
  if (!omit) {
    if (keyArg === 'control-word' && valueArg !== 'off') {
      behaviorText = `begin every response with \`${valueArg} — \` as a session-health marker; if the marker is missing, context may be degrading`
    } else {
      behaviorText = await loadBehaviorText(root, keyArg, valueArg)
    }

    if (!behaviorText) {
      console.error(`truss set: no behavior template found for '${keyArg}/${valueArg}'`)
      console.error(`Expected at: .truss/prefs/${keyArg}/${valueArg}.md`)
      process.exit(2)
    }
  }

  // Load current prefs from the block
  let ctx
  try {
    ctx = await loadWorkspace(root)
  } catch (err) {
    console.error(`truss set: failed to load workspace — ${err.message}`)
    process.exit(2)
  }

  const prefsBlock = ctx.blocks?.get('preferences')
  const currentRows = prefsBlock ? parsePrefsRows(prefsBlock.innerLines ?? []) : []

  // Build row map from current block; update the target key. An omit-value
  // removes the row so nothing renders for this preference.
  const rowMap = new Map(currentRows.map(r => [r.key, r]))
  if (omit) {
    rowMap.delete(keyArg)
  } else {
    rowMap.set(keyArg, { key: keyArg, value: valueArg, behavior: behaviorText })
  }

  // Rebuild in catalog order; append any extra rows not in catalog at the end
  const catalogKeys = PREFS_CATALOG.map(e => e.key)
  const ordered = [
    ...catalogKeys.filter(k => rowMap.has(k)).map(k => rowMap.get(k)),
    ...[...rowMap.values()].filter(r => !catalogKeys.includes(r.key)),
  ]
  // Retired keys never reach the writer — a `set` is the migration moment.
  const kept = ordered.filter(r => !RETIRED_KEYS.has(r.key))

  const newInnerLines = renderPrefsBlock(kept)

  // Lines an older instance wrote that no longer belong: values that now render
  // nothing (every key's 'off' since D-028) and keys retired by D-029. Both are
  // dropped here rather than silently carried in the OTHER group.
  const dropped = ordered.filter(r =>
    r.key !== keyArg && (isOmitValue(r.key, r.value) || RETIRED_KEYS.has(r.key)))

  try {
    await writeBlock(agentsMdPath, 'preferences', newInnerLines)
    console.log(`truss set: ${keyArg} = ${valueArg}${omit ? ' (no directive written)' : ''}`)
    if (dropped.length) {
      console.log(`  removed ${dropped.length} directive(s) that are retired or now the default: ${dropped.map(r => `${r.key}=${r.value}`).join(', ')}`)
    }
  } catch (err) {
    console.error(`truss set: failed to write block — ${err.message}`)
    process.exit(2)
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
// Handlers keyed by command name. This key set is the dispatch surface; the same
// names live in COMMAND_META (which drives `help`), so the two stay in lockstep —
// preventing documented-but-undispatched drift (the bug class that left `tag`
// half-wired).
const HANDLERS = {
  doctor:    (args) => runDoctor(args),
  render:    ()     => runRender(),
  'split-decisions': async (args) => {
    const { runSplitDecisions } = await import('../lib/commands/split-decisions.mjs')
    return runSplitDecisions(root, args)
  },
  set:       (args) => runSet(args[0], args[1]),
  ack:       (args) => runAck(args),
  phase:     (args) => runPhase(root, args),
  status:    (args) => runStatus(root, args),
  map:       (args) => runMap(root, args),
  skills:    (args) => runSkills(root, args),
  // init targets the caller's cwd (or --root), never silently the engine's own
  // directory (D-024) — pass where the user actually stands.
  init:      (args) => runInit(root, args, process.cwd()),
  // upgrade runs the NEW engine (this script) against the workspace the caller
  // stands in — the reverse direction of every other command.
  upgrade:   (args) => runUpgrade(root, args, process.cwd()),
}

// init/phase surface user-facing fatals as a throw → exit code 2.
const THROWS_TO_EXIT_2 = new Set(['init', 'upgrade', 'phase', 'skills', 'split-decisions'])

if (!command || ['help', '--help', '-h'].includes(command)) {
  showHelp(); process.exit(0)
}

if (['--version', '-v', 'version'].includes(command)) {
  console.log(`truss ${getVersion()}`); process.exit(0)
}

const handler = HANDLERS[command]
if (!handler) {
  console.error(`truss: unknown command '${command}'. Run 'node .truss/bin/truss.mjs help'.`)
  process.exit(1)
}

// Argument gate (D-060). Every command validates its own flags here, from the
// one declared surface — so `--help` explains a command wherever it appears
// instead of being ignored while the command RUNS, and a typo never falls
// through into a writing command.
const meta = COMMAND_BY_NAME.get(command)
if (meta) {
  const verdict = inspectArgs(meta, args)
  if (verdict.help) { showCommandHelp(meta); process.exit(0) }
  if (verdict.unknown) {
    console.error(`truss ${command}: unknown argument '${verdict.unknown}'.`)
    console.error(`Run 'node .truss/bin/truss.mjs ${command} --help'.`)
    process.exit(1)
  }
}

if (THROWS_TO_EXIT_2.has(command)) {
  try { await handler(args) }
  catch (err) { console.error(err.message); process.exit(2) }
} else {
  await handler(args)
}
