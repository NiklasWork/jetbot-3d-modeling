// lib/command-meta.mjs — single source of truth for the CLI command surface.
//
// The dispatcher's help text derives from this one list, so "documented but
// not dispatched" drift (the class of bug that left `tag` half-wired) cannot
// recur. Data only — NO handler imports.
//
//   name          dispatch key (process.argv command)
//   display       left column in `truss help`
//   summary       right column in `truss help`
//   flags         every flag the command accepts, `value: true` when the flag
//                 consumes the following token. The dispatcher rejects anything
//                 else and routes `--help` at ANY position to the help text, so
//                 a typo can never fall through into a writing command (D-060).
//   literalFrom   index in the command's argument list from which tokens are
//                 user payload, not CLI syntax (preference values). Nothing at
//                 or past it is inspected.

export const COMMAND_META = [
  {
    name: 'status', display: 'status',
    summary: 'show a compact workspace status summary',
    flags: {},
  },
  {
    name: 'doctor', display: 'doctor [flags]',
    summary: 'check workspace health (all findings, by severity)',
    flags: { '--gate': {}, '--html': {}, '--json': {}, '--fix-prompt': {} },
  },
  {
    name: 'render', display: 'render',
    summary: 'sync phase block in AGENTS.md from state/phases.md',
    flags: {},
  },
  {
    name: 'split-decisions', display: 'split-decisions [--dry-run]',
    summary: 'move state/decisions.md into one file per decision (D-087)',
    flags: { '--dry-run': {} },
  },
  {
    name: 'phase', display: 'phase [<id>] [--override-gate]',
    summary: 'show phases, or gate and set the current phase',
    flags: { '--override-gate': {} },
  },
  {
    name: 'set', display: 'set <key> <val>',
    summary: 'update a preference in the preferences block',
    flags: {}, literalFrom: 1,
  },
  {
    name: 'ack', display: 'ack context [flags]',
    summary: 'record that the boot context was reviewed at its current size',
    flags: { '--clear': {}, '--note': { value: true, equals: false } },
  },
  {
    name: 'init', display: 'init [flags]',
    summary: 'configure a fresh workspace (flags or interactive)',
    flags: {
      '--name': { value: true }, '--lang': { value: true },
      '--overlay': {}, '--no-phases': {}, '--code-root': { value: true },
      '--adopt-agents': {}, '--root': { value: true },
      '--skills': { value: true }, '--findings': { value: true },
    },
  },
  {
    name: 'skills', display: 'skills <list|add|remove> [group]',
    summary: 'manage baseline skill groups',
    flags: {},
  },
  {
    name: 'upgrade', display: 'upgrade [flags]',
    summary: 'lift an existing workspace to this engine version',
    flags: { '--force': {}, '--dry-run': {}, '-n': {}, '--root': { value: true } },
  },
  {
    name: 'map', display: 'map',
    summary: 'regenerate the state/map.md domain file overview',
    flags: {},
  },
  {
    name: 'help', display: 'help',
    summary: 'show this message',
    flags: {},
  },
]

export const COMMAND_BY_NAME = new Map(COMMAND_META.map(c => [c.name, c]))

const HELP_FLAGS = new Set(['--help', '-h'])

/**
 * Inspect one command's arguments against its declared flag surface.
 *
 * Returns `{ help: true }` when `--help`/`-h` appears anywhere the command reads
 * as syntax, `{ unknown: '<flag>' }` for anything not declared, else `{}`.
 * Values of value-taking flags and everything from `literalFrom` on are payload
 * and never inspected — a prompt body may legitimately start with a dash.
 */
export function inspectArgs(meta, args) {
  const literalFrom = meta.literalFrom ?? Infinity
  for (let i = 0; i < args.length && i < literalFrom; i++) {
    const arg = args[i]
    if (typeof arg !== 'string' || !arg.startsWith('-') || arg === '-') continue
    const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg
    if (HELP_FLAGS.has(name)) return { help: true }
    const spec = meta.flags[name]
    if (!spec) return { unknown: arg }
    if (arg.includes('=') && spec.equals === false) return { unknown: arg }
    // Skip the value token so `--note --clear` keeps "--clear" as the note.
    if (spec.value && !arg.includes('=')) i++
  }
  return {}
}
