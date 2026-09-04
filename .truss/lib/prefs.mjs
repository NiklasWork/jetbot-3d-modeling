// lib/prefs.mjs — Preferences catalog (single source of truth)
// Imported by checks/bl.mjs (validation) and the set command (validation + row ordering).
// Catalog order defines the canonical row order in the preferences block.

// D-028: every key defaults to 'off' and 'off' renders NO directive line —
// a fresh AGENTS.md carries an empty preferences block (0 boot tokens). A
// directive exists only when the human explicitly sets a deviation from the
// host agent's native behavior.
// D-029: nine keys. A key earns its place only when projects genuinely differ
// AND the exact wording is worth not reinventing. Everything whose floor is
// universally right now lives as a fixed rule in AGENTS.md §3/§4 — the key only
// sells the harder variant (clarify, branch-guard) or is gone entirely.
export const PREFS_CATALOG = [
  { key: 'subagents',       values: ['off', 'research', 'full'],                default: 'off', omit: ['off'] },
  { key: 'verify-inputs',   values: ['off', 'on'],                              default: 'off', omit: ['off'] },
  { key: 'clarify',         values: ['off', 'ask', 'infer'],                    default: 'off', omit: ['off'] },
  { key: 'scope',           values: ['off', 'minimal', 'balanced', 'thorough'], default: 'off', omit: ['off'] },
  { key: 'auto-commit',     values: ['off', 'suggest', 'on'],                   default: 'off', omit: ['off'] },
  { key: 'gate-advocate',   values: ['off', 'on', 'agentic'],                   default: 'off', omit: ['off'] },
  { key: 'branch-guard',    values: ['off', 'strict'],                          default: 'off', omit: ['off'] },
  { key: 'control-word',    values: ['off'],                                    default: 'off', omit: ['off'], free: true },
]

// Keys retired in D-029. Their behaviour either became a fixed rule in AGENTS.md
// or merged into a surviving key. An existing workspace keeps rendering them
// until its next `truss set`; BL-03 reports them as a warning with the migration
// hint instead of an unknown-key error, so upgrading never turns doctor red.
export const RETIRED_KEYS = new Map([
  ['orchestration',   'merged into `subagents` (autonomy floor is AGENTS.md §4)'],
  ['research-agent',  'merged into `subagents` (use `subagents research`)'],
  ['review-agent',    'merged into `subagents` (use `subagents full`)'],
  ['criticality',     'now a fixed rule — AGENTS.md §3 names plan weaknesses before executing'],
  ['input-trust',     'renamed to `verify-inputs`'],
  ['source-citation', 'belongs in state/profile.md § Style & moral as a one-line preference'],
  ['post-task-check', 'now a fixed rule — AGENTS.md §4 runs doctor before reporting done'],
  ['phase-lock',      'now a fixed rule — AGENTS.md §4 names the conflict and asks'],
  ['response-style',  'now a fixed rule — AGENTS.md §4: record and report are two artefacts; the response form follows the task'],
])

// Keys whose value is free-form (not restricted to the listed values).
// `control-word` may be 'off' or any short word the human picks (session-health marker).
export const FREE_VALUE_KEYS = new Set(
  PREFS_CATALOG.filter(e => e.free).map(e => e.key)
)

// Validate a free value: 'off' or a short word/token.
export function isValidFreeValue(value) {
  return value === 'off' || /^[A-Za-z][A-Za-z0-9-]{0,23}$/.test(value)
}

// Map: key → Set of values that render NO directive in AGENTS.md at all.
// `set` skips behavior lookup and drops the row; renderPrefsBlock filters them
// defensively. `scope=off` means "impose no solution-scope bias — omit the line".
export const OMIT_VALUES = new Map(
  PREFS_CATALOG.filter(e => e.omit).map(e => [e.key, new Set(e.omit)])
)

// True when (key, value) should produce no preferences-block line.
export function isOmitValue(key, value) {
  return OMIT_VALUES.get(key)?.has(value) ?? false
}

// Map for bl.mjs validation: key → Set of valid values
export const CATALOG_KEYS = new Map(
  PREFS_CATALOG.map(e => [e.key, new Set(e.values)])
)
