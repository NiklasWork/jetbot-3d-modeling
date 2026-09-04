// lib/defaults.mjs — C1 wiring: the canonical default preferences for a fresh
// instance, rendered from PREFS_CATALOG defaults + behavior texts on disk.
//
// C1 (OFFENE-FRAGEN.md): PREFS_CATALOG.default is the single source of truth for
// the preferences block that `init` renders into a fresh AGENTS.md. The behavior
// column is never hard-coded — it is read from .truss/prefs/<key>/<value>.md
// (custom override: prompts/custom/prefs/<key>/<value>.md), exactly like
// `truss set` does. This module is that shared loader; bin/truss.mjs runSet
// imports loadBehaviorText so there is one — and only one — place that resolves
// a behavior text (GE-13, no duplicate logic).
//
// Zero external dependencies — node: built-ins only.

import fs from 'node:fs/promises'
import path from 'node:path'
import { PREFS_CATALOG, FREE_VALUE_KEYS, isOmitValue } from './prefs.mjs'

/**
 * Resolve the behavior text for a preference value.
 *
 * Looks up the markdown body (everything after the frontmatter) of:
 *   1. prompts/custom/prefs/<key>/<value>.md   (project override, if present)
 *   2. .truss/prefs/<key>/<value>.md         (built-in default)
 * The first that exists wins. Returns null if neither is found, so callers can
 * decide how to fail (set → hard error; defaultPrefsRows → throw with context).
 *
 * @param {string} root   Absolute workspace root.
 * @param {string} key    Preference key (e.g. 'orchestration').
 * @param {string} value  Preference value (e.g. 'medium').
 * @returns {Promise<string|null>}  The trimmed behavior text, or null if absent.
 */
export async function loadBehaviorText(root, key, value) {
  const candidates = [
    path.join(root, '.truss', 'prompts', 'custom', 'prefs', key, `${value}.md`),
    path.join(root, '.truss', 'prefs', key, `${value}.md`),
  ]

  for (const p of candidates) {
    let raw
    try {
      raw = await fs.readFile(p, 'utf8')
    } catch {
      continue
    }
    // Body after frontmatter (--- ... ---), same parsing as the old runSet.
    const lines = raw.split('\n')
    let bodyStart = 0
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1)
      bodyStart = end === -1 ? 0 : end + 1
    }
    return lines.slice(bodyStart).join('\n').trim()
  }

  return null
}

/**
 * Build the canonical default preference rows for a fresh instance (C1).
 *
 * Iterates PREFS_CATALOG in catalog order (which defines the canonical row order
 * in the block) and pairs each key's `default` value with its behavior text from
 * disk. The result is ready to hand to renderPrefsBlock().
 *
 * Free-value keys (control-word) with a non-'off' default generate their
 * behavior text dynamically — the same logic as `truss set` uses — because
 * there is no .md template for arbitrary custom words.
 *
 * @param {string} root  Absolute workspace root (must contain .truss/prefs/).
 * @returns {Promise<Array<{key: string, value: string, behavior: string}>>}
 * @throws {Error} if a default value has no behavior text on disk — a fresh
 *   instance must never render a preference with an empty behavior column, so a
 *   missing template is a hard error rather than a silent gap.
 */
export async function defaultPrefsRows(root) {
  const rows = []
  for (const { key, default: value } of PREFS_CATALOG) {
    // Omit-values (e.g. scope=off) render no line — skip entirely.
    if (isOmitValue(key, value)) continue

    let behavior

    // Free-value keys with a custom (non-'off') value generate behavior text
    // dynamically, matching the same logic used by `truss set`.
    if (FREE_VALUE_KEYS.has(key) && value !== 'off') {
      if (key === 'control-word') {
        behavior = `begin every response with \`${value} — \` as a session-health marker; if the marker is missing, context may be degrading`
      }
    }

    // Fall back to disk template for everything else.
    if (!behavior) {
      behavior = await loadBehaviorText(root, key, value)
    }

    if (behavior == null) {
      throw new Error(
        `defaultPrefsRows: no behavior template for '${key}/${value}' ` +
        `(expected at .truss/prefs/${key}/${value}.md)`
      )
    }
    rows.push({ key, value, behavior })
  }
  return rows
}
