# Architecture

For contributors to the Truss engine itself. If you only want to *use* Truss,
read [concepts.md](concepts.md) and [cli.md](cli.md) instead.

The whole engine lives in the hidden `.truss/` directory. It is plain ESM,
Node ≥ 20, **zero external dependencies** — a deliberate constraint, not an
accident. Nothing here is published to npm; the directory *is* the distribution.

## Engine layout

```
.truss/
├── bin/truss.mjs      # CLI dispatcher — argv → command handler
├── lib/                 # shared library
│   ├── command-meta.mjs # the canonical command list (drives help + the argument gate)
│   ├── workspace.mjs    # locate & load a workspace
│   ├── scaffold.mjs     # atomic/no-overwrite whole-file primitives
│   ├── writer.mjs       # generated-block writer
│   ├── render.mjs       # render phase / preferences blocks
│   ├── decisions-index.mjs # build state/decisions-index.md from the decision log
│   ├── schema.mjs       # the entry classes, read from docs/schema.md (never a constant)
│   ├── prefs.mjs        # preferences catalogue (single source of truth)
│   ├── md.mjs           # markdown parsing helpers
│   ├── severity.mjs     # E/W/I severity + family metadata
│   ├── engine-manifest.mjs # hash + verify the engine's own files (writes and checks MANIFEST.sha256)
│   ├── defaults.mjs     # default preference rows + behaviour text
│   └── commands/        # init, status, map, phase, skills, upgrade handlers
├── checks/              # one module per check family (st, bl, rf, sy, ph, cx, hy)
├── docs/                # product documentation (concepts, cli, architecture)
├── baseline/            # the pristine workspace skeleton `init` scaffolds from
├── phase-profiles/      # ready-made phase lists to copy over state/phases.md (not installed)
├── prompts/             # where your own prompts go under custom/ (see its README)
├── prefs/               # behaviour text fragments per preference value
├── tests/               # the engine test suite + fixtures
├── VERSION              # current version string
└── MANIFEST.sha256      # sha256 of every engine file, written at release time (D-070)
```

## Design rules worth knowing

**1. Single source of truth for the command surface.** Every command is declared
once in `lib/command-meta.mjs` (name, help summary, accepted flags). `truss help`,
the per-command `--help` text, and the argument gate that rejects unknown flags
all derive from that one list, so "documented but not dispatched" or "accepted
but undocumented" drift cannot happen.

**2. Writer ownership is explicit.** Mutation is limited to command-owned
surfaces:

- `init` uses `scaffold.mjs` for atomic/no-overwrite whole-file operations,
  including rollback and the explicit `--adopt-agents` merge.
- `writer.mjs` writes the **generated blocks** (the preferences and phase blocks
  in `AGENTS.md`) for `init`, `render`, `set`, and `phase`.
- `phase` owns the `current:` update in `state/phases.md`; `map` owns
  `state/map.md`; `render` (and `init`) own `state/decisions-index.md`, which is
  derived from `the decision log` and never edited by hand; doctor report modes
  own files under `.truss/out/`.

Checks and `status` are read-only.

## Checks

Each file in `checks/` owns one family and exports:

- a `meta` array declaring every check it implements (`id`, `severity`, `title`),
  so `doctor --json` can enumerate the full catalogue even for checks that didn't
  fire; and
- the check functions themselves, which take the loaded workspace and return
  findings.

Severity (`E`/`W`/`I`), sort order, and family display names are centralised in
`lib/severity.mjs` so no consumer keeps a private copy. Adding a check means
adding its `meta` entry and logic in the right family module — nothing else needs
to know about it.

## Baseline & scaffolding

`baseline/` is the canonical fresh-instance format: the exact `AGENTS.md`, state
files, docs, adapter stubs, and `package.json` a new workspace starts with.
`init` resolves and validates the phase source and AGENTS.md adoption before the
first write, writes substituted skeletons, then copies the rest of the tree with
`applyTree`, skipping anything already present. A fatal write or render failure
restores modified files and removes files created by that run. Because
the state grammars the `SY` checks enforce are grounded in this baseline, the
baseline *is* the spec — keep them in sync. `baseline/docs/schema.md` is that
literally rather than by convention: it is the file SY-03 and the reference
checks read, and a workspace without its own copy is checked against the one
here.

## Tests

The engine has its own suite under `tests/`, run with Node's built-in test
runner. There is no root
`package.json` — run the runner from inside the engine directory:

```bash
cd .truss
node --test          # discovers all suites recursively
```

Tests use fixtures in `tests/fixture/` and temporary directories
(`tests/tmp-*/`, gitignored) so they never touch a live workspace. The CLI is
written to be testable in-process: handlers like `runInit` return a result object
and throw typed errors, which the dispatcher maps to exit codes.

## Contributing checklist

- Keep the **zero-dependency** rule: standard library only.
- A new command → add it to `command-meta.mjs` first.
- A new check → add its `meta` entry and logic to the right family module. If the
  check exists to prevent *silence* — a state where other checks would pass
  having examined nothing — enumerate the partial failures too, not only the
  total one. One bad row in a table is the case that gets missed, and it is the
  likelier one (`L-011`).
- A change to the workspace format → update `baseline/` and the matching checks
  together.
- A change to what an entry *is* — a class, a file, a field → `baseline/docs/schema.md`.
  There is no ID-class constant in the source; `md.mjs`, `checks/rf.mjs` and SY-03
  all read that file through `lib/schema.mjs` (D-079).
- `node --test` (from `.truss/`) green, and `truss doctor` clean on a fresh
  `init`, before you ship.
