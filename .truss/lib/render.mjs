// lib/render.mjs — Phase block and prefs block renderers
// Pure functions — no I/O. Called by bin/truss.mjs render and set commands.

import { isOmitValue } from './prefs.mjs'

/**
 * Ensure a fragment ends with exactly one sentence terminator (a period).
 * Strips trailing whitespace and a single existing terminator (. ! ?) before
 * appending '.', so a source value is rendered with one period whether or not
 * it already carries one — prevents the double-period bug (B2).
 *
 * @param {string} text
 * @returns {string}
 */
export function endSentence(text) {
  return String(text).replace(/[.!?]?\s*$/, '') + '.'
}

/**
 * Format a Date as "YYYY-MM-DDTHH:MM" (local time, no seconds).
 */
export function formatTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Render the phase block inner content from a phase definition.
 *
 * @param {object} phaseDef  — parsed phase object from workspace.phases.defs
 * @param {string} phaseId   — phase ID (e.g. "discover")
 * @param {number} position  — 1-based position in ordered phase list
 * @param {number} total     — total number of phases
 * @param {string} [ts]      — timestamp string "YYYY-MM-DDTHH:MM" (defaults to now)
 * @returns {string[]}       — lines to place between the markers (no trailing newline)
 */
export function renderPhaseBlock(phaseDef, phaseId, position, total, ts) {
  const timestamp = ts ?? formatTimestamp()
  const label = phaseDef.label || phaseDef.name || phaseId

  const lines = []

  // Provenance line (always first)
  lines.push(
    `> Rendered ${timestamp} from \`state/phases.md\` — edit there, then run \`truss render\`. Advancing \`current:\` is human-only (propose via HUMAN-TODOS.md); phase definitions are agent-maintained — restructure with a D-NNN and tell the human (AGENTS.md §5).`
  )
  lines.push('')

  // Phase heading
  lines.push(`**Phase ${position}/${total} — ${phaseId} (${label})**`)

  // Purpose (required)
  if (phaseDef.purpose) lines.push(`Purpose: ${phaseDef.purpose}`)

  // Behavior (required)
  if (phaseDef.behavior) lines.push(`Behavior: ${phaseDef.behavior}`)

  // Allowed + Forbidden on one line (compact).
  // endSentence normalises the terminator so values that already end in '.'
  // are not rendered with a double period (B2).
  const allowed  = phaseDef.allowed
  const forbidden = phaseDef.forbidden
  if (allowed && forbidden) {
    lines.push(`Allowed: ${endSentence(allowed)} Forbidden: ${endSentence(forbidden)}`)
  } else if (allowed) {
    lines.push(`Allowed: ${endSentence(allowed)}`)
  } else if (forbidden) {
    lines.push(`Forbidden: ${endSentence(forbidden)}`)
  }

  // Read list
  if (phaseDef.read) {
    lines.push(`Read this phase (beyond §1): ${phaseDef.read}`)
  }

  // Exit criteria
  if (phaseDef.exit) {
    lines.push(`Exit (checked by \`doctor --gate\`): ${phaseDef.exit}`)
  }

  // Prompts
  if (phaseDef.prompts) {
    lines.push(`Prompts: ${phaseDef.prompts} (\`.truss/prompts/\`)`)
  }

  return lines
}

/**
 * The canonical phase-block content for a workspace WITHOUT `state/phases.md`.
 *
 * Absent is not broken (U4): a workspace may legitimately run with no phase
 * model, and then the generated block must say so instead of advertising gates
 * that do not exist. Three places need this exact text — `truss render`,
 * `truss phase`, and the BL-02 drift comparison — so it is defined once here.
 * Three copies would drift apart and produce the very BL-02 error this design
 * is meant to prevent.
 *
 * English regardless of `--lang`, like the boot prompt in init.mjs: the block
 * is part of the canonical skeleton, not of the project's own prose.
 *
 * @returns {string[]} lines to place between the phase block markers
 */
export function renderNoPhasesBlock() {
  return [NO_PHASES_NOTICE]
}

export const NO_PHASES_NOTICE =
  '> No phases configured. This workspace runs without a phase model: no gates, ' +
  'no forbidden lists, no exit criteria. Add `state/phases.md` and run `truss render` to enable them.'

// Enforcement-priority groups for the agent-optimized directives block.
// HARD rules render first. Keys not listed here fall into a trailing "OTHER"
// group so unknown/extra rows still render (keeps `set` robust). Adding a new
// preference key here only changes grouping; rendering tolerates missing keys.
export const PREFS_GROUPS = [
  { title: 'HARD — STOP conditions; never violate silently', keys: ['clarify', 'branch-guard'] },
  { title: 'AUTONOMY',               keys: ['subagents', 'gate-advocate'] },
  { title: 'RIGOR & VERIFICATION',   keys: ['verify-inputs'] },
  { title: 'WORKFLOW',               keys: ['scope', 'auto-commit'] },
  { title: 'RESPONSE',               keys: ['control-word'] },
]

/**
 * Render the preferences block inner content from key→{value,behavior} rows.
 *
 * Agent-optimized format (robust against markdown auto-formatters): each
 * directive is a list item `- key=value :: directive`, grouped by enforcement
 * priority with bold headers, HARD stop-rules first. List items and bold lines
 * survive reformatting; the parser keys off the ` :: ` delimiter only.
 *
 * @param {Array<{key,value,behavior}>} rows  — current rows (any order)
 * @returns {string[]}  — lines to place between the markers
 */
export function renderPrefsBlock(rows) {
  // Drop values flagged as "omit" (e.g. scope=off): they render no line.
  rows = rows.filter(r => !isOmitValue(r.key, r.value))

  // Empty block = all preferences at their 'off' default (D-028): render a
  // single pointer line so the block costs ~0 boot tokens.
  if (rows.length === 0) {
    return ['> empty — all preferences off (host-agent defaults). Set via `node .truss/bin/truss.mjs set <key> <value>`.']
  }

  const byKey = new Map(rows.map(r => [r.key, r]))
  const used = new Set()
  const lines = []

  lines.push(
    '> Machine-written via `node .truss/bin/truss.mjs set <key> <value>` — never edit by hand. Apply HARD rules first.'
  )

  for (const group of PREFS_GROUPS) {
    const present = group.keys.filter(k => byKey.has(k))
    if (present.length === 0) continue
    lines.push('')
    lines.push(`**${group.title}**`)
    for (const k of present) {
      const { key, value, behavior } = byKey.get(k)
      lines.push(`- ${key}=${value} :: ${behavior}`)
      used.add(k)
    }
  }

  const extras = rows.filter(r => !used.has(r.key))
  if (extras.length > 0) {
    lines.push('')
    lines.push('**OTHER**')
    for (const { key, value, behavior } of extras) {
      lines.push(`- ${key}=${value} :: ${behavior}`)
    }
  }

  return lines
}

/**
 * Parse the inner lines of the preferences block into key→{value,behavior} rows.
 * Skips provenance and empty lines; returns rows in table order.
 *
 * @param {string[]} innerLines
 * @returns {Array<{key,value,behavior}>}
 */
export function parsePrefsRows(innerLines) {
  const rows = []
  let headerSeen = false

  for (const line of innerLines) {
    const trimmed = line.trim()

    // New format: "- key=value :: directive" (tolerant of -/* bullets, spacing).
    const m = trimmed.match(/^[-*]\s+([A-Za-z][\w-]*)=(\S+)\s*::\s*(.*\S)\s*$/)
    if (m) {
      rows.push({ key: m[1], value: m[2], behavior: m[3] })
      continue
    }

    // Legacy format: markdown table "| key | value | behavior |".
    if (!line.startsWith('|')) continue
    if (/^\|[-: |]+\|$/.test(trimmed)) continue  // separator
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (!headerSeen) {
      headerSeen = true
      if (cells[0]?.toLowerCase() === 'key') continue  // skip header
    }
    if (cells.length >= 2) {
      rows.push({ key: cells[0], value: cells[1], behavior: cells[2] ?? '' })
    }
  }

  return rows
}

/**
 * Parse exit items from the exit string in phases.md.
 * Items are semicolon-separated. Each item is one of:
 *   file: <path>                     → machine check: file exists
 *   glob: <pattern>                  → machine check: ≥1 match
 *   section: <file>#<heading>        → machine check: heading exists in file
 *   <free text> (human)              → human-only check
 *   <other free text>                → treated as (human) with a lint warning
 *
 * @param {string} exitStr
 * @returns {Array<{type:'file'|'glob'|'section'|'human'|'unknown', raw:string, path?:string, pattern?:string, file?:string, heading?:string}>}
 */
export function parseExitItems(exitStr) {
  if (!exitStr) return []

  return exitStr.split(';').map(item => {
    const raw = item.trim()
    if (!raw) return null

    if (raw.startsWith('file:')) {
      return { type: 'file', raw, path: raw.slice(5).trim() }
    }
    if (raw.startsWith('glob:')) {
      return { type: 'glob', raw, pattern: raw.slice(5).trim() }
    }
    if (raw.startsWith('section:')) {
      const ref = raw.slice(8).trim()
      const [file, heading] = ref.split('#')
      return { type: 'section', raw, file: file?.trim(), heading: heading?.trim() }
    }
    if (raw.endsWith('(human)')) {
      return { type: 'human', raw }
    }
    // Non-conforming: treat as human but tag as unknown for PH-01 lint
    return { type: 'unknown', raw }
  }).filter(Boolean)
}

/**
 * Simple glob-to-regex converter (zero dependencies).
 * Handles: ** (any path segments), * (any chars in one segment), ? (one char).
 * Does NOT handle character classes [abc] — that's rare in truss patterns.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegex(pattern) {
  // Normalise separators
  const p = pattern.replace(/\\/g, '/')
  let regex = ''
  let i = 0
  while (i < p.length) {
    const ch = p[i]
    if (ch === '*') {
      if (p[i + 1] === '*') {
        // ** — match anything including /
        regex += '.*'
        i += 2
        if (p[i] === '/') i++ // skip trailing slash after **
      } else {
        // * — match anything except /
        regex += '[^/]*'
        i++
      }
    } else if (ch === '?') {
      regex += '[^/]'
      i++
    } else {
      // Escape regex special chars
      regex += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      i++
    }
  }
  return new RegExp('^' + regex + '$')
}
