// checks/bl.mjs — Generated Block checks (BL-01 … BL-03)
//
// BL-01  E  truss marker missing, duplicated, or unpaired in AGENTS.md
// BL-02  E  phase block content has drifted from state/phases.md (content comparison)
// BL-03  E  preferences block has unknown key, invalid value, or grammar error

import { CATALOG_KEYS, FREE_VALUE_KEYS, isValidFreeValue, RETIRED_KEYS } from '../lib/prefs.mjs'
import { renderPhaseBlock, renderNoPhasesBlock, parsePrefsRows } from '../lib/render.mjs'

// Declarative catalog of the checks this module implements (A2).
export const meta = [
  { id: 'BL-01', severity: 'E', title: 'Block marker missing, duplicated, or unpaired' },
  { id: 'BL-02', severity: 'E', title: 'Phase block drifted from state/phases.md' },
  { id: 'BL-03', severity: 'E', title: 'Preferences block: bad key, value, or grammar' },
]

// Known block IDs required in AGENTS.md
const REQUIRED_BLOCK_IDS = ['preferences', 'phase']

/**
 * @param {import('../lib/workspace.mjs').WorkspaceContext} ctx
 * @returns {Promise<Array>}
 */
export async function run(ctx) {
  const findings = []
  const { blocks } = ctx

  // ── BL-01: required markers must be present, paired, and not duplicated ──
  for (const id of REQUIRED_BLOCK_IDS) {
    const block = blocks.get(id)

    if (!block) {
      findings.push({
        id: 'BL-01', severity: 'E',
        file: 'AGENTS.md',
        message: `block '${id}': begin and end markers are both missing`,
        fix: `Add <!-- truss:begin ${id} --> and <!-- truss:end ${id} --> to AGENTS.md`,
      })
      continue
    }

    if (block.duplicateBegin) {
      findings.push({
        id: 'BL-01', severity: 'E',
        file: 'AGENTS.md',
        line: block.startLine,
        message: `block '${id}': duplicate begin marker`,
        fix: `Remove the extra <!-- truss:begin ${id} --> marker`,
      })
    }

    if (block.orphanBegin) {
      findings.push({
        id: 'BL-01', severity: 'E',
        file: 'AGENTS.md',
        line: block.startLine,
        message: `block '${id}': begin marker has no matching end marker`,
        fix: `Add <!-- truss:end ${id} --> after the block content`,
      })
    }

    if (block.orphanEnd) {
      findings.push({
        id: 'BL-01', severity: 'E',
        file: 'AGENTS.md',
        line: block.endLine,
        message: `block '${id}': end marker has no matching begin marker`,
        fix: `Add <!-- truss:begin ${id} --> before the block content`,
      })
    }
  }

  // ── BL-02: phase block content drift check (content comparison, not mtime) ──
  const phaseBlock = blocks.get('phase')
  if (phaseBlock && !phaseBlock.orphanBegin && !phaseBlock.orphanEnd && !phaseBlock.duplicateBegin) {
    const innerLines = phaseBlock.innerLines ?? []
    const firstInner = innerLines[0] ?? ''

    if (firstInner.includes('YYYY-MM-DDTHH:MM') || firstInner.includes('YYYY-MM-DD')) {
      // Template placeholder — never rendered
      findings.push({
        id: 'BL-02', severity: 'E',
        file: 'AGENTS.md',
        line: phaseBlock.startLine + 1,
        message: 'phase block has never been rendered (contains template placeholder)',
        fix: 'Run: node .truss/bin/truss.mjs render',
      })
    } else if (!ctx.phases?.stat) {
      // No state/phases.md (U4). The workspace has no phase model, so the block
      // must carry exactly the canonical one-line notice — anything else is a
      // block that still advertises gates, forbidden lists and exit criteria
      // this workspace does not have. `render` and `phase` write the same text
      // from lib/render.mjs, so a match here is drift-free by construction.
      const expected = renderNoPhasesBlock().join('\n')
      const actual = innerLines.join('\n').trim()
      if (actual !== expected) {
        findings.push({
          id: 'BL-02', severity: 'E',
          file: 'AGENTS.md',
          line: phaseBlock.startLine + 1,
          message: 'phase block describes a phase model, but state/phases.md could not be read',
          fix: 'Run: node .truss/bin/truss.mjs render (writes the no-phases notice), or restore a readable state/phases.md',
        })
      }
    } else if (ctx.phases) {
      // Verify provenance line format
      const tsMatch = firstInner.match(/Rendered (\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/)
      if (!tsMatch) {
        findings.push({
          id: 'BL-02', severity: 'E',
          file: 'AGENTS.md',
          line: phaseBlock.startLine + 1,
          message: 'phase block: first line must be the render provenance line ("> Rendered YYYY-MM-DDTHH:MM from ...")',
          fix: 'Run: node .truss/bin/truss.mjs render',
        })
      } else {
        // Content comparison: render expected block (with sentinel timestamp) and compare body
        // Line 0 always contains the timestamp — skip it when comparing
        const { ordered, defs, frontmatter } = ctx.phases
        const currentId = frontmatter?.current
        if (currentId && defs.has(currentId)) {
          const phaseDef = defs.get(currentId)
          const position = ordered.indexOf(currentId) + 1
          const total = ordered.length
          // Render with a sentinel timestamp; compare everything except line 0
          const expected = renderPhaseBlock(phaseDef, currentId, position, total, '0000-00-00T00:00')
          const expectedBody = expected.slice(1).join('\n')
          const actualBody = innerLines.slice(1).join('\n')

          if (expectedBody !== actualBody) {
            findings.push({
              id: 'BL-02', severity: 'E',
              file: 'AGENTS.md',
              line: phaseBlock.startLine + 1,
              message: 'phase block content has drifted from state/phases.md',
              fix: 'Run: node .truss/bin/truss.mjs render',
            })
          }
        }
      }
    }
  }

  // ── BL-03: preferences block grammar validation ─────────────────────────
  // Format-agnostic: parsePrefsRows accepts the agent-optimized directive list
  // (`- key=value :: directive`) and the legacy `| key | value | behavior |`
  // table. Validate keys/values against the catalog; flag a content block that
  // yields no parseable directives.
  const prefsBlock = blocks.get('preferences')
  if (prefsBlock && !prefsBlock.orphanBegin && !prefsBlock.orphanEnd && !prefsBlock.duplicateBegin) {
    const innerLines = prefsBlock.innerLines ?? []
    const rows = parsePrefsRows(innerLines)
    const line = prefsBlock.startLine || 1

    const hasContent = innerLines.some(l => {
      const t = l.trim()
      return t && !t.startsWith('>') && !t.startsWith('<!--') && !t.startsWith('**')
    })
    if (rows.length === 0 && hasContent) {
      findings.push({
        id: 'BL-03', severity: 'E',
        file: 'AGENTS.md',
        line,
        message: 'preferences block: no directives found (expected "- key=value :: directive" lines)',
        fix: 'Regenerate via: node .truss/bin/truss.mjs set <key> <value>',
      })
    }

    const seenKeys = new Set()
    for (const { key, value } of rows) {
      if (!CATALOG_KEYS.has(key)) {
        // A key retired by a catalog change is a migration hint, not an error:
        // an upgraded workspace must never go red for a line it wrote correctly
        // under the previous version.
        const retired = RETIRED_KEYS.get(key)
        findings.push({
          id: 'BL-03', severity: retired ? 'W' : 'E', file: 'AGENTS.md', line,
          message: retired
            ? `preferences block: '${key}' is retired — ${retired}`
            : `preferences block: unknown key '${key}'`,
          fix: retired
            ? `Delete the line, or run any \`truss set <key> <value>\` — the writer drops retired directives`
            : `Remove the directive for '${key}' or update the prefs catalog`,
        })
        continue
      }

      if (seenKeys.has(key)) {
        findings.push({
          id: 'BL-03', severity: 'E', file: 'AGENTS.md', line,
          message: `preferences block: duplicate key '${key}'`,
          fix: `Remove the duplicate '${key}' directive`,
        })
      }
      seenKeys.add(key)

      const validValues = CATALOG_KEYS.get(key)
      if (FREE_VALUE_KEYS.has(key)) {
        if (!isValidFreeValue(value)) {
          findings.push({
            id: 'BL-03', severity: 'E', file: 'AGENTS.md', line,
            message: `preferences block: invalid value '${value}' for key '${key}' (expected 'off' or a short word)`,
            fix: `Set '${key}' to 'off' or a short word (letters/digits/-)`,
          })
        }
      } else if (!validValues.has(value)) {
        findings.push({
          id: 'BL-03', severity: 'E', file: 'AGENTS.md', line,
          message: `preferences block: invalid value '${value}' for key '${key}' (valid: ${[...validValues].join(', ')})`,
          fix: `Change the value of '${key}' to one of: ${[...validValues].join(', ')}`,
        })
      }
    }
  }

  return findings
}
