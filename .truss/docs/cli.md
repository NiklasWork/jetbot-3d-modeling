# CLI reference

Every command runs through the dispatcher:

```bash
node .truss/bin/truss.mjs <command> [flags]
```

In the examples below, `truss` is shorthand for the full `node .truss/bin/truss.mjs` command.
The CLI has **zero dependencies** and needs only Node ≥ 20.

The command surface is defined once in `.truss/lib/command-meta.mjs`, which
drives `truss help` and the argument gate — so the help text can never drift
from what is actually dispatched.

---

## `init`

Preflight and scaffold a workspace from the core baseline. Fatal write failures
roll back files created by that run. Existing files are preserved unless the
user explicitly adopts `AGENTS.md` or overlay init adds `repo/` to an existing
`.gitignore`.

```bash
truss init --name "My Project" --lang English
```

| Flag | Meaning |
|---|---|
| `--name <name>` | project name (used in `profile.md`, VISION/README titles); skips the interactive prompt |
| `--lang <lang>` | primary language for agent output, e.g. `English`, `German` |
| `--overlay` | existing-project mode: installs the `ingest → operate` phase flow and adds `repo/` to `.gitignore`. `init` never places the code itself — clone or symlink it into `repo/` yourself |
| `--no-phases` | scaffold without `state/phases.md`. The workspace then runs with no phase model at all: no gates, no `forbidden` lists, no exit criteria, and the `AGENTS.md` phase block carries a one-line notice instead. The default stays *with* phases — gates are the one place Truss can refuse. Reversible in both directions: add `state/phases.md` and run `render` to switch phases on, delete it and run `render` to switch them off. init refuses rather than deleting an existing `state/phases.md` |
| `--code-root <dir>` | (overlay only) select exactly one existing relative in-workspace directory as the code-worktree boundary instead of `repo/`; it is not moved or added to `.gitignore` |
| `--adopt-agents` | preserve a marker-free existing `AGENTS.md` as a preamble and append the Truss router; without this flag init refuses before writing |
| `--root <path>` | explicit workspace target; defaults to the directory you run init from. A target other than the engine's own directory must carry its own `.truss/` engine at the same `VERSION`, otherwise init aborts before writing |
| `--skills <selection>` | install `none` (default), `all` groups, or comma-separated group IDs such as `superpowers,ecc`. In a TTY without this option, init offers an interactive group choice, defaulting to none. The skills are optional because their frontmatter alone is context your host agent loads into every session — around 8.7k tokens for the full set, which Truss cannot see or budget. Add them later with `truss skills add <group>`. `.claude/SOURCES.md` is always installed as provenance |
| `--findings <on\|off>` | collect agent findings about Truss itself in `state/truss-findings.md` (default `on`). With `off`, every AGENTS.md / conventions mention of the channel is omitted — zero boot cost for instances that do not want it. Decision is fixed at init time |

`init` scaffolds the directory it is invoked from (or `--root`), never silently
the engine's install location. Before the first write it probes that the target
is writable and deletable; if a fatal error still leaves a partial rollback,
the remaining paths are listed in `truss-init-rollback.txt`.

`--code-root` does not relocate the workspace, the `.truss/` engine, or Truss
state. It writes the normalized POSIX path to `state/profile.md`; status,
branch-guard, phase evidence, code-root checks, and `map` then use
that same boundary. The directory must already exist inside the workspace and
must not be a Truss-managed top-level path. Absolute paths, backslashes, and
`..` traversal are rejected. Omit the option for the standard `repo/` overlay.

With no flags in a TTY, `init` asks interactively. With no TTY and missing
required answers it errors instead of hanging.

For the full existing-project flow, see [overlay.md](overlay.md). The installed
phase is a seed, not a plan: a fresh workspace ships one `kickoff` phase, and
the kickoff replaces it with the lifecycle this project actually needs. Agents
may restructure the plan later (D-NNN + telling the human; advancing `current:`
stays human-only) — see [concepts.md §5](concepts.md#5-phases).

---

## `skills`

List, add, or remove baseline skill groups after initialization. Groups are
discovered from the `.claude/skills/` directories and `.claude/agents/` files in
the installed baseline; no separate catalog is maintained.

```bash
truss skills list
truss skills add context7
truss skills remove marketing
truss skills add all
```

`add` never overwrites an existing skill or agent. `remove` deletes only
unchanged baseline assets from the selected group, including that group's
agents; existing or modified files are preserved. A restricted selection is
stored in `.claude/.truss-skills.json` so future upgrades do not reinstall
opted-out groups; the file is absent only when every group is enabled. A default
`init` installs no group, so a fresh workspace carries it with an empty list —
that is what keeps a later `upgrade` from installing all of them behind you.

---

## `upgrade`

Lift an existing workspace to a newer Truss version. Unlike every other command,
`upgrade` is run from the **new** engine against the **old** workspace — so an
instance on any past version can be lifted by any later release, and the upgrade
logic is always the current one.

```bash
git clone --depth 1 https://github.com/KornLabs/truss.git /tmp/truss
node /tmp/truss/.truss/bin/truss.mjs upgrade      # from your project directory
```

| Flag | Meaning |
|---|---|
| `--root <path>` | workspace to upgrade; defaults to the directory you run the command from |
| `--dry-run`, `-n` | print the plan and change nothing |
| `--force` | proceed despite an unclean git tree, or re-apply at the same version |

What it does, in order: refuse if the workspace has uncommitted changes (that
commit is your rollback) or if a backup from an earlier run is still lying
around; stage the new engine into `.truss.incoming/` and carry `prompts/custom/`
over; swap it in by renaming `.truss/` to `.truss.bak-<old-version>/`; then
reconcile the baseline files. `--dry-run` stops after planning and is not gated
on a clean tree. Unfinished work exits with code `3`.

The merge base comes free: every installed engine ships the `.truss/baseline/`
it scaffolded the workspace from, so the old baseline, the new baseline and your
file are all on disk. Per file — unchanged upstream is skipped, unmodified
locally is taken from the new baseline, non-overlapping changes are merged, and
a genuine conflict lands in `<file>.truss-merge` with your file untouched. Files
that left the baseline are kept as yours; files you deleted are not resurrected.

The baseline's **seed** files — `state/*`, `VISION.md`, `README.md` — are never
written, only reported: `init` writes them once and after that they are project
matter, not Truss's to rewrite. `context/`, `HUMAN-TODOS.md`, `archive/` and your
code root are not baseline files at all and are never looked at. The generated
blocks in `AGENTS.md` are excluded from the merge, so `truss render` / `truss set`
stay their only writers.

Whatever is left needs judgment, not mechanics: the printed prompt hands it to
your agent via [`docs/rituals/upgrade.md`](rituals/upgrade.md), which also
covers the semantic half — `doctor` names retired preference keys and their
replacements after the swap. Full walkthrough: [upgrade.md](upgrade.md).

---

## `status`

Print a compact, read-only summary of the workspace — current date/time, phase,
and health. The **canonical session-start command** (AGENTS.md §4): agents run it
first every session. The `Date:` line is a temporal anchor — agents have no
reliable clock, and a current timestamp lets them date what they write.
When `state/profile.md` configures a
`code-root`, it also prints a **Branch** line: the live code-root branch against the
`branch:` declared in `state/current.md` (`✓` when they match, `✗ MISMATCH` with a
switch hint when they don't). This is the live branch check — `doctor` itself
stays purely file-based and never reads the live branch (see `branch-guard`).

When the workspace has domain files, it prints a **Domains** block — the register
of what the project is currently working on, one line per domain: its name, its
`focus:`, how many open points its `next:` lists, and how long since the file was
last touched. Freshest first, at most eight, then a count pointing at
`state/map.md`. It is **generated on every run** from the frontmatter of the
`context/**.md` files themselves, never stored, so it cannot drift from them —
a file counts as a domain exactly when its frontmatter carries a non-empty
`focus:` (see `docs/conventions.md`). A workspace without such files — every
fresh `init` — prints no block and is not flagged for it.

When the workspace is a git repository, a **Recent** block follows: the last five
commits, subject truncated to one line each. It replaced the hand-maintained
`recently-done:` key in `state/current.md` (D-074) — git already carries the same
information, current and without upkeep. Outside a git repository the block is
simply absent, and the exit code is unaffected.

When more than one agent session is working in the same tree, a **Parallel**
block reports what the current session cannot see for itself (D-101): how many
sessions are live, which paths were already uncommitted when this one began,
what moved since its own last `truss` run, and whether a `.git/index.lock` is
present. It is **visibility, not coordination** — nothing is locked, claimed or
queued, and the exit code never changes, so `doctor --gate` cannot start failing
because a colleague is present. Silent whenever there is nothing to say, which
is the normal case for a single session in a quiet tree.

It needs no cleanup command. Each session's record lives under
`.truss/out/presence/` (gitignored), and **reading is the cleanup**: a record
whose process is gone is removed by the next read, by whichever session reads
first. A session that is merely hung keeps its record — it is still present, and
dropping it would under-report. On Windows the process ancestry is not
available, so no session count is printed rather than a wrong one; the rest of
the block still works. `TRUSS_NO_PRESENCE=1` turns the whole layer off, the way
`TRUSS_NO_GIT=1` turns off git.

`status` closes with an **Open** block whenever `state/open-decisions.md` holds
entries: each `OD-NNN` with its title, its age in days, and — when a decision
carries a `Challenged-by:` marker — which decision it contests. Silent when
nothing is undecided; at most five entries, then a count. It comes last because
it is the one thing that must not scroll away: a question waiting on the human,
seen at session start.

```bash
truss status
```

---

## `doctor`

Check workspace health. Runs every check family (see
[concepts.md §6](concepts.md#6-checks-the-doctor)) and prints findings grouped by
severity. **Read-only** — it never edits your files.

```bash
truss doctor              # human-readable report
truss doctor --gate       # also run phase-exit (PH-04) checks
truss doctor --json       # print the report as JSON on stdout, and write
                          #   .truss/out/doctor.json (for tooling)
truss doctor --html       # write .truss/out/doctor.html (static report)
truss doctor --fix-prompt # print a copyable remediation prompt for an agent
```

`--json` writes to **stdout** as well as to the file, so `truss doctor --json |
jq '.findings'` works. The note naming the written path goes to stderr, which
keeps the pipe clean. `--fix-prompt` also writes to stdout, so combining the two
puts two formats in one stream — pick one per run if you are piping.

**Exit codes** (useful in CI): `0` clean · `1` warnings only · `2` at least one
error.

The human-readable report ends with the same **Parallel** block `status` prints
(D-101), reduced: it counts live sessions and compares the core state files by
hash, and runs **no git at all** — `doctor` stays purely file-based, git lives in
`status` alone. It reports and never changes the exit code. `--json`, `--html`
and `--fix-prompt` return before it, so machine-readable output is never touched
by it.

**Silenced findings.** An info finding you have deliberately answered can be
switched off for one file by writing the reason into that file:
`<!-- truss: st-05 ok — reference table; splitting it would break the format -->`.
The report then ends with a line counting what it silenced, so the decision stays
visible. Info only, and the reason is required — the full rule is in your
workspace's `docs/conventions.md`.

---

## `render`

Regenerate what the workspace derives from its own files: the phase block inside
`AGENTS.md` (from `state/phases.md`) and the decision index
`state/decisions-index.md` (from `state/decisions/`, or from `state/decisions.md` in a workspace that has not split). Run it after any edit to
the phase definitions, the `current:` pointer, or a decision entry. This is the
only sanctioned writer of both; editing the phase block by hand is a `BL` error,
and a hand-edit of the index is reported by `ST-10` and overwritten on the next
run.

```bash
truss render
```

The index is what AGENTS.md §1 loads every session: one bold list item per
decision, carrying its title and its status, with the bodies opened on demand —
the ones a task touches, and all of them before a decision is made or proposed.
It is a plain workspace file — commit it. An entry whose body is incomplete is
still indexed rather than dropped. Missing the file entirely is not an error
(`ST-10` reports it as info); an index that disagrees with the decision bodies
is a warning, because §1 then feeds every session a decision log that no longer
exists. Adding the file changes what `state/map.md` should contain, so run
`truss map` after the first `render` that creates it.

Without `state/phases.md` the command is not an error: the workspace has no phase
model, so `render` writes the one-line no-phases notice into the block and exits
`0`. Run it after deleting the file — until you do, `BL-02` reports the block that
still promises gates the workspace no longer has. A `state/phases.md` that exists
but cannot be read is a different case and stays fatal (exit `2`, block untouched):
absent is not the same as broken.

---

## `split-decisions`

Move a single-file `state/decisions.md` into one body per entry under
`state/decisions/D-NNN.md` (D-087). A one-time migration, and opt-in: the
single-file layout stays fully supported and produces no finding, so nothing
forces this. What it buys is measurable — the boot index drops from roughly 77
to 20 tokens per decision, and looking one up costs one small file instead of
the whole log.

```bash
truss split-decisions --dry-run   # what it would write, nothing touched
truss split-decisions
```

It is a split, not a rewrite: every body is copied through unchanged, and the
run proves it by rebuilding the entry list before and after and refusing to keep
a result whose entries differ. It refuses outright when the workspace is already
split, when an id appears twice (one body would overwrite another), or when a
heading carries a malformed id such as `## D-99` (the parser would swallow it
into the entry above). A failure partway rolls back to the workspace it started
with.

Two things it deliberately does **not** do. It never deletes the preamble — the
text above the first entry, including pointers to already-archived ranges — so
`state/decisions.md` is left holding it; route that content and remove the file
by hand. And content *below* the last entry cannot be told apart from that
entry's own trailing note, so it travels with it; when the run sees a horizontal
rule in that body it says which file to check. Afterwards, run `truss render` and
`truss map`.

`upgrade` will never do this for you: it does not write `state/`, because a
template diff must not be able to rewrite recorded decisions (AGENTS.md §5).

---

## `phase`

Show the phases, or set the current one. With no argument it lists every defined
phase and marks where you are. With an `<id>` it validates the id against
`state/phases.md`, updates the `current:` pointer, and re-renders the `AGENTS.md`
phase block — the supported alternative to hand-editing `current:` and remembering
to `render`. Before changing `current:`, the command runs the active phase's exit
gate.

```bash
truss phase            # list phases, show the current one
truss phase operate                    # switch only when the exit gate is clear
truss phase operate --override-gate    # explicit human confirmation/override
```

In a workspace without `state/phases.md` the command reports that there is no
phase model, sets the block to the no-phases notice, and exits `0`.

Phase changes stay **human-only** by protocol (AGENTS.md §4). The CLI cannot
authenticate the caller, but it refuses unmet machine or human gate results
unless `--override-gate` is present. That flag records explicit intent; it is not
proof that a human invoked the command.

---

## `set`

Change one agent preference. The value is validated against the catalogue before
the preferences block in `AGENTS.md` is rewritten.

```bash
truss set verify-inputs on
truss set clarify ask
```

### Preference keys

| Key | Values | Default |
|---|---|---|
| `subagents` | off · research · full | off |
| `verify-inputs` | off · on | off |
| `clarify` | off · ask · infer | off |
| `scope` | off · minimal · balanced · thorough | off |
| `auto-commit` | off · suggest · on | off |
| `gate-advocate` | off · on · agentic | off |
| `branch-guard` | off · strict | off |
| `control-word` | `off` or any short word | off |

Every key defaults to `off`, and `off` renders **no directive line** — a fresh
workspace ships an empty preferences block that costs no boot context. Setting
any other value writes exactly one directive line; setting a key back to `off`
removes its line. The block therefore only ever contains the human's explicit
deviations from the host agent's native behavior.

Upgrading from an older instance: existing `key=off` directives stay readable and
`doctor` accepts them, but the next `set` of any key rewrites the block without
them — they are the default now. `set` names each line it drops. Keys retired in
D-029 (`orchestration`, `research-agent`, `review-agent`, `criticality`,
`input-trust`, `source-citation`, `post-task-check`, `phase-lock`) and
`response-style`, retired before the beta freeze, are reported by `BL-03` as a
warning naming their replacement, never as an error.

---

## `ack`

Record that the mandatory boot context (AGENTS.md §1 load order) was read through
and judged lean at its current size.

```bash
truss ack context                       # record the current measurement as the reviewed baseline
truss ack context --note "24 decisions, all live"
truss ack context --clear               # drop the baseline
```

`CX-01` judges the boot context against absolute bands (18k warn / 30k error).
An absolute band cannot tell a bloated workspace from a legitimately big one, so
without this command a lean project that grows past 18k carries a permanent,
unclearable warning — and an unclearable finding trains you to stop reading
`doctor`. The ack turns the question into *growth since the last review*.

While the measurement stays within **15 %** of the reviewed baseline, `CX-01` is
**downgraded to info** — never hidden: the current number, the baseline, the ack
date and the re-fire ceiling all stay in the report, and `doctor --gate` is no
longer blocked by a question that was already answered. Past the ceiling it warns
again at full severity. **The error band (30k) is never downgraded** — an ack
cannot silence an error, and `truss ack context` refuses to record one.

The record lives in `.truss/out/context-ack.json`, gitignored like `doctor.json`:
it is a local reading judgement, not a project fact, so it costs zero boot tokens
and a fresh clone correctly starts unreviewed.

The trim itself is the `cleanup` ritual (`.truss/docs/rituals/cleanup.md`), which
proposes dispositions and leaves execution to you.

---

## `map`

Regenerate `state/map.md`, the auto-generated overview of the domain files under
`context/`. Read-only for your content; it only rewrites the map file.

Each row carries a `~Tokens` column: the estimated read cost of that file
(words × 1.5, the same method as the boot-budget check, coarsely rounded).
Agents weigh this cost before loading a file — the map shows what exists *and*
what it costs to know. Estimates refresh on each `truss map` run; token drift
alone never marks the map as outdated (doctor's ST-07 compares maps with the
tokens column stripped, so ordinary editing does not create noise).

```bash
truss map
```

---

## `help`

List all commands with a one-line summary.

```bash
truss help
```
