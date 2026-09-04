#!/usr/bin/env node
// .truss/bin/truss.mjs — Truss CLI dispatcher
// Node >= 20, ESM, zero external dependencies.
// Usage: node .truss/bin/truss.mjs <command> [flags]
//
// M2: doctor (ST/BL/RF checks) + --fix-prompt + --json + exit codes
// M3: render, set, --gate, PH checks
// M4: init (workspace scaffolding)
// M5: SY/CX/HY checks, doctor --html
// M6: dashboard server

import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadWorkspace, resolveRoot } from '../lib/workspace.mjs'

const root = resolveRoot(import.meta.url)

const [,, command, ...args] = process.argv

// ── Helpers ───────────────────────────────────────────────────────────────────
function getVersion() {
  try { return readFileSync(path.join(root, '.truss', 'VERSION'), 'utf8').trim() }
  catch { return '?' }
}

const SEV_ORDER = { E: 0, W: 1, I: 2 }
const SEV_COLOR = {
  E: s => `\x1b[31m${s}\x1b[0m`,
  W: s => `\x1b[33m${s}\x1b[0m`,
  I: s => `\x1b[36m${s}\x1b[0m`,
}
function col(sev, text) {
  return process.stdout.isTTY ? (SEV_COLOR[sev] || (s => s))(text) : text
}

// ── Help ──────────────────────────────────────────────────────────────────────
function showHelp() {
  console.log(`truss ${getVersion()} — workspace health and state management
Workspace: ${root}

Commands:
  doctor [flags]    check workspace health (all findings, sorted by severity)
  render            sync phase block in AGENTS.md from state/phases.md   [M3]
  set <key> <val>   update a preference in the preferences block          [M3]
  init              configure a fresh workspace (interactive)             [M4]
  help              show this message

Doctor flags:
  --gate        also run PH-04 phase-exit checks                         [M3]
  --html        write report as HTML to .truss/out/doctor.html         [M5]
  --json        write report as JSON to .truss/out/doctor.json
  --fix-prompt  output a copyable remediation prompt for all findings

Exit codes: 0 = clean · 1 = warnings only · 2 = errors present
`)
}

// ── doctor ────────────────────────────────────────────────────────────────────
async function runDoctor(flags) {
  const wantJson      = flags.includes('--json')
  const wantFixPrompt = flags.includes('--fix-prompt')
  const wantHtml      = flags.includes('--html')

  // Load workspace
  let ctx
  try {
    ctx = await loadWorkspace(root)
  } catch (err) {
    console.error(`truss doctor: failed to load workspace — ${err.message}`)
    process.exit(2)
  }

  // Run all M2 check modules (no first-fail — all run regardless of others)
  const modules = await Promise.all([
    import('../checks/st.mjs'),
    import('../checks/bl.mjs'),
    import('../checks/rf.mjs'),
  ])

  const allFindings = []
  for (const mod of modules) {
    try {
      allFindings.push(...(await mod.run(ctx)))
    } catch (err) {
      allFindings.push({
        id: 'INTERNAL', severity: 'E',
        file: '(check runner)',
        message: `check threw an unexpected error: ${err.message}`,
        fix: 'Report this as a truss bug — include the stack trace from stderr',
      })
      console.error(err)
    }
  }

  // Sort: E → W → I, then by file+line
  allFindings.sort((a, b) =>
    ((SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)) ||
    (a.file || '').localeCompare(b.file || '') ||
    ((a.line || 0) - (b.line || 0))
  )

  const errors   = allFindings.filter(f => f.severity === 'E')
  const warnings = allFindings.filter(f => f.severity === 'W')
  const infos    = allFindings.filter(f => f.severity === 'I')
  const exitCode = errors.length > 0 ? 2 : warnings.length > 0 ? 1 : 0

  // ── JSON output ─────────────────────────────────────────────────────────
  if (wantJson) {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const report = {
      timestamp: new Date().toISOString(),
      root,
      version: getVersion(),
      summary: { errors: errors.length, warnings: warnings.length, infos: infos.length, total: allFindings.length },
      findings: allFindings,
    }
    const outDir  = path.join(root, '.truss', 'out')
    const outFile = path.join(outDir, 'doctor.json')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
    console.error(`Report written to .truss/out/doctor.json`)
    if (!wantFixPrompt) process.exit(exitCode)
  }

  // ── Fix-prompt output ────────────────────────────────────────────────────
  if (wantFixPrompt) {
    if (allFindings.length === 0) {
      console.log('No findings — nothing to fix.')
    } else {
      const lines = [
        'Fix the following truss findings exactly as described below.',
        'Do not change anything else.',
        'After fixing, run:  node .truss/bin/truss.mjs doctor',
        '',
      ]
      for (const f of allFindings) {
        const loc = f.line ? `${f.file}:${f.line}` : (f.file || '')
        lines.push(`${f.severity}  ${f.id}  ${loc}`)
        lines.push(`  Problem: ${f.message}`)
        lines.push(`  Fix:     ${f.fix}`)
        lines.push('')
      }
      console.log(lines.join('\n'))
    }
    process.exit(exitCode)
  }

  // ── Human-readable output ────────────────────────────────────────────────
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16)
  console.log(`\ntruss doctor — ${now}\n`)

  if (allFindings.length === 0) {
    console.log('  ✓  All checks passed.\n')
  } else {
    for (const f of allFindings) {
      const loc = f.line ? `${f.file}:${f.line}` : (f.file || '')
      console.log(
        `  ${col(f.severity, f.severity)}  ` +
        `${col(f.severity, f.id.padEnd(8))}  ` +
        `${loc.padEnd(38)}  ` +
        `${f.message}`
      )
    }
    console.log('')
  }

  // Summary
  const parts = []
  if (errors.length)   parts.push(col('E', `${errors.length} error${errors.length !== 1 ? 's' : ''}`))
  if (warnings.length) parts.push(col('W', `${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`))
  if (infos.length)    parts.push(col('I', `${infos.length} info`))
  console.log(
    parts.length
      ? `  ${allFindings.length} finding${allFindings.length !== 1 ? 's' : ''} (${parts.join(', ')})\n`
      : '  0 findings\n'
  )
  if (errors.length > 0) console.log('  Run with --fix-prompt for a copyable remediation prompt.\n')

  process.exit(exitCode)
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
const NOT_YET = { render: 'M3', set: 'M3', init: 'M4', add: 'M4', dashboard: 'M6' }

if (!command || ['help', '--help', '-h'].includes(command)) {
  showHelp(); process.exit(0)
}
if (command === 'doctor') {
  await runDoctor(args)
} else if (NOT_YET[command]) {
  console.error(`truss ${command}: not yet implemented (scheduled for ${NOT_YET[command]}).`)
  console.error('See STRUKTUR.md for the build roadmap.')
  process.exit(1)
} else {
  console.error(`truss: unknown command '${command}'. Run 'node .truss/bin/truss.mjs help'.`)
  process.exit(1)
}
