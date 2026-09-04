# Concepts

This is the mental model behind Truss. Read it once and the file layout, the
CLI, and the agent's behaviour all follow from the same few ideas.

## 1. Files are the source of truth

Everything a project knows lives in plain Markdown. There is no database and no
hidden state. If you want to know what the project has decided, you open
`state/decisions/`. If you want to change it, you edit the file. The CLI never
owns the truth — it only reads these files, checks that they agree with each
other, and reports what it finds. This is what makes Truss portable, diffable,
and free of lock-in: a workspace is just a folder of text.

A direct consequence: **every fact has exactly one canonical home.** You link to
it, you never copy it. Two files holding the same number or name is treated as a
bug (the `RF` checks catch it).

## 2. The boot file: AGENTS.md

`AGENTS.md` is the one file every agent reads in full, every session. It follows
the open [AGENTS.md](https://agents.md) convention, so it is tool-agnostic — small
adapter stubs (`CLAUDE.md`, `GEMINI.md`, `.cursorrules`,
`.github/copilot-instructions.md`) each contain a single line pointing back to it.

`AGENTS.md` defines:

- **Load order (§1)** — the handful of files an agent must read before doing
  anything, and the rule to stop reading as soon as the task is unambiguous.
- **Structure & routing (§2)** — a table of every core file, who owns it
  (Human / Agent / Script), and what belongs in it. This table is the authority
  on *where information goes* — routing policy, maintained by agents. It is not
  a file inventory: that is `state/map.md`, script-generated, listing domain
  files with per-file read-cost estimates. Two jobs, two mechanisms — the table
  says where things belong, the map says what exists and what it costs to read.
- **Rules, session protocol, hard limits (§3–§5)** — how an agent works, what it
  must do at the start and end of a session, and the things it may never do
  (e.g. change the phase, edit a generated block by hand, commit secrets).

Those limits are portable agent instructions, not a file-system sandbox. Truss
can report evidence after the fact; it cannot prove who invoked a command or
intercept writes made by an arbitrary agent host.

Two regions of `AGENTS.md` are **generated** and marked with `truss:begin/end`
comments: the *preferences* block and the *phase* block. You never edit these by
hand — `truss set`, `truss render`, `truss phase`, and init route updates through
the block writer.

## 3. The state layer

`state/` is the project's working memory. Each file has a single job:

| File | Holds |
|---|---|
| `current.md` | the live focus: what you're doing, next actions (≤5), blockers |
| `decisions.md` | decided decisions, each a `D-NNN` entry; superseded, never deleted |
| `decisions-index.md` | the boot-sized view of `decisions.md` — title plus `Decision:` line per entry; written by `truss render`, never by hand |
| `open-decisions.md` | undecided questions with options and trade-offs (`OD-NNN`), including challenges to recorded decisions; ships with the workspace and stays when empty |
| `phases.md` | the phase definitions and the `current:` pointer; optional — a workspace without it runs with no phase model |
| `profile.md` | project name, language, tools, PM method, style notes |
| `risks.md` | project, launch, safety, strategy, or blocker risks (`R-NNN`); created at its first entry |
| `learnings.md` | recurring agent weaknesses and structural fixes (`L-NNN`); created at its first entry |
| `map.md` | a script-generated overview of domain files with per-file read-cost estimates (on demand) |

Only `current.md`, `decisions.md`, `decisions-index.md`, `phases.md`, and
`profile.md` exist from `init` (`phases.md` unless you pass `--no-phases`). Everything else appears the moment its first real entry does — a fresh
workspace carries no empty placeholder files (D-028).

Everything that *describes a topic* rather than the project's process goes into a
**domain file** under `context/<domain>.md`, created on demand. Domain files are
not pre-registered — `state/map.md` maps them automatically.

## 4. Structured IDs

Truss uses a small set of sequential, never-reused IDs so that any claim can be
traced to one place:

- `D-NNN` — a decision
- `OD-NNN` — an open (undecided) question
- `HT-NNN` — a human-only to-do
- `L-NNN` — a learning
- `R-NNN` — a risk
- `TF-NNN` — a finding about Truss itself

The `RF` checks verify links and structured IDs across Truss operational files,
including every non-ignored Markdown file under `context/`.

**The set is yours to extend.** Which classes exist, which file each lives in
and which fields it owes is a table in `docs/schema.md`, and that table is what
the checks read. Add a row — say, `BL` for a backlog in `state/backlog.md` — and
`BL-042` is a structured ID from that moment: references to a missing entry are
warnings, duplicate definitions are errors, and entries that do not match the
form you wrote are flagged. No fork, no engine change.

## 5. Phases

Every project gets its **own phase plan** — a linear lifecycle tailored to the
project, drafted at kickoff from the vision and maintained by agents as the
project evolves. Truss ships **no ready-made lifecycle**: `init` installs a
single real phase,

```
kickoff
```

whose job is to produce the plan. `kickoff` is an interview phase — it turns the
raw idea into `VISION.md`, `state/profile.md`, and the phase list this project
actually needs (e.g. discovery, validation, launch, migration, or operate
phases), and it forbids leaving that seeded list in place as if it were the
plan. Each phase declares its `allowed`, `forbidden`, `forbidden-globs`, the
files to `read`, and the `exit` criteria that must be met to leave it.

Inside a `## <phase-id>` section, every line is `key: value`; a wrapped value
continues on an **indented** line. Free text is not allowed there — the file is
rendered into every session boot, so `PH-01` reports any other line.

Three rules define the phase protocol:

1. **Phase changes are human-only.** An agent never edits `current:` in
   `state/phases.md` or declares a phase done. When exit criteria look met, it
   runs `doctor --gate`, writes an `HT-NNN` summary, and stops. The human decides.
2. **The plan is agent-maintained, never silently.** When requirements change,
   an agent restructures the future phases on its own (the `phase-replan`
   prompt) — but every restructuring requires a `D-NNN`, an explicit mention to
   the human, then `truss render` + `doctor`. Loosening the *current* phase's
   `forbidden`/`forbidden-globs` or `exit` criteria requires explicit human
   confirmation first: an agent must not remove its own active guardrails.
3. **The phase block is generated.** `state/phases.md` is the source; running
   `truss render` writes the human-readable phase block into `AGENTS.md` so an
   agent always sees the active rules without loading the whole phase file.

The phase model itself is optional. A workspace whose `state/phases.md` is absent
runs without one: the phase block says so in one line, the `PH` checks stay silent,
and `render`, `phase` and `status` treat the absence as a configuration rather than
a defect. The trade is real and one-sided — no gates, no `forbidden` lists, no exit
criteria, which is the only place Truss can say "no". Absence is not the same as
damage: a `phases.md` that is present but empty, malformed or unreadable stays an
error. Switch phases on by adding the file and running `truss render`; switch them
off by deleting it and running `truss render`.

The protocol is advisory. PH-03 reports forbidden globs only when they match
uncommitted paths visible through git; it does not detect changes committed
since the phase began because Truss stores no phase-start revision. PH-07 makes
that coverage limit visible. `truss phase <id>` runs the current phase's exit
gate first and refuses the transition unless it passes or a human deliberately
uses `--override-gate`; the flag is explicit confirmation, not actor
authentication.

An existing codebase uses the **overlay** flow (`ingest → operate`) via
`init --overlay` — also a seed the onboarding replaces with the real plan.

One ready-made alternative ships as a pattern to copy rather than a default:
`.truss/phase-profiles/founders-thinking.md` (discover → validate → concept) is
for a project whose goal is to think an idea through and reach an honest
pursue/park call, not to build it. Copy it over `state/phases.md` and run
`truss render`; its own README has the steps.

## 6. Checks (the doctor)

`truss doctor` runs a catalogue of checks grouped into families. Each finding
has a severity — **E**rror, **W**arning, or **I**nfo — and an ID like `ST-02`:

| Family | Guards |
|---|---|
| `ST` Structure | the structure table matches what's actually on disk, the generated `state/map.md` and `state/decisions-index.md` still match their sources, and the installed engine matches its release manifest |
| `BL` Block | the generated preference/phase blocks haven't drifted |
| `RF` Reference | operational links resolve and D/OD/HT/R/L/TF IDs are defined exactly once, including under `context/` |
| `SY` State | the state files have the required keys, valid entry grammar, and no unrecorded drift |
| `PH` Phase | grammar, uncommitted forbidden-path evidence, and `--gate` exit criteria |
| `CX` Context | mandatory Truss boot metadata stays under the configured estimate |

**What the checks do *not* see.** `doctor` loads the files the §2 structure table names individually, plus every non-ignored markdown file under `context/` and `archive/`. A row that names a *directory* — `docs/`, `.claude/` in the shipped table — is not expanded: its contents are never loaded, so `RF-01`, `RF-02`, `RF-03` and `ST-05` stay silent there. The same holds for anything matched by `.trussignore` or `.gitignore`, and for `.truss/` itself. List a file individually in the §2 table if you want it checked; a binding procedure left under `docs/` or an unlisted directory is present, not validated — this is exactly why project-wide planning moved out of a dedicated `pm/` directory (U6/D-074) into a domain file under `context/`, which *is* loaded and checked. The one deliberate exception is `ST-09`: it compares the engine's own files against `.truss/MANIFEST.sha256` by hash, not by loading them, and stays silent when no manifest is installed.

`doctor` is read-only. It reports; it never edits your files. `--fix-prompt`
emits an instruction block you can hand to an agent, `--json` is for tooling, and
`--html` writes a report. `--gate` is the phase-exit check.

Without terminal access, Truss degrades to manual Markdown operation: agents can
still follow the structure, but `doctor`, `render`, `set`, and `map` cannot
provide mechanical validation or generated updates. Say that plainly when a
workspace was changed without running the CLI.

| Missing command | Manual fallback |
|---|---|
| `doctor` | inspect touched files and disclose that mechanical validation did not run |
| `render` | edit `state/phases.md` and `state/decisions/` only; the phase block and `state/decisions-index.md` may be stale until CLI returns — say so, and read the decision bodies meanwhile |
| `set` | do not hand-edit generated preferences; leave the change as a human todo |
| `map` | use existing domain files directly; `state/map.md` may be stale |

## 7. Preferences

A small catalogue of nine preferences tunes how agents behave — autonomy,
whether to ask or infer, commit behaviour, response style, and so on. They live
in the generated preferences block of `AGENTS.md` and are changed only through
`truss set <key> <value>`, which validates the value against the catalogue.
Every key defaults to `off` and renders nothing — a fresh workspace has an
empty block that costs no boot context, and a directive line exists only for
the deviations the human explicitly sets (D-028). What is universally right is
not a preference at all: naming plan weaknesses before executing, naming the
assumption behind an unclear task, naming a forbidden-path or branch conflict,
and running `doctor` before reporting done are fixed rules in AGENTS.md §3/§4.
A key exists only where projects genuinely differ (D-029). The full list of keys
and values is in [cli.md](cli.md#set).

## 8. Prompts

Truss ships **no** prompt library. `prompts/custom/<id>.md` is where you put your own, and you open them yourself — no command reads that directory and no check verifies it. Earlier versions shipped ten library prompts plus three engine rituals; they were removed because they loaded every fresh instance with pre-made method knowledge. Two survive as engine rituals under [`docs/rituals/`](rituals/): `cleanup.md`, the controlled-forgetting procedure that `CX-01` and `SY-09` name in their `fix:` text, and `upgrade.md`, the standing instruction for the judgment half of an upgrade. A `fix:` string a check prints is a supported contract, so it must keep pointing at a file that exists. Details:
[prompts/README.md](../prompts/README.md).

---

Put together: **files hold the truth, `AGENTS.md` boots the agent, the state
layer is the memory, phases guide the work, and the doctor reports detectable
drift.** Everything else in the repo is an implementation of these ideas.
