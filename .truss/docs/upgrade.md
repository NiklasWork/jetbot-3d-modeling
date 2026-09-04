# Upgrading a workspace to a new Truss version

Two commands and, if anything needed judgment, one pasted prompt.

```bash
# From the project you want to upgrade:
git clone --depth 1 https://github.com/KornLabs/truss.git /tmp/truss
node /tmp/truss/.truss/bin/truss.mjs upgrade
```

Commit your work first — `upgrade` refuses to run into an unclean tree, because
that commit is the rollback. `--dry-run` prints the plan and changes nothing; it
works on a dirty tree, so you can look before you commit.

The command prints what it did per file and what, if anything, is left. When
something is left, it prints a prompt to paste into your AI tool and exits with
code `3`, so a script can tell an unfinished upgrade from a clean one; the agent
resolves the rest and runs `doctor`. Then delete `.truss.bak-<old-version>/`.

## Why it runs from the new engine

Every other command runs from the engine installed in your workspace. `upgrade`
is the reverse: the **new** engine acts on the **old** workspace. That is what
makes it work across arbitrary version gaps — the code doing the upgrade is
always the newer one, so a workspace that has sat untouched for five releases
upgrades exactly like one release behind. You never have to upgrade in steps,
and an old install never needs to have shipped with upgrade support.

## What gets touched

| | |
|---|---|
| **Replaced** | `.truss/` — the engine. Staged next to the workspace, then swapped in by rename; the old one becomes `.truss.bak-<old-version>/` and is never deleted. `prompts/custom/` is carried over. Local edits to the engine itself are *replaced*, and named before that happens — see below. |
| **Reconciled** | The **framework** files: `AGENTS.md`, `docs/*.md`, `package.json`, `.gitignore`, `.trussignore`, the adapter stubs. You edit these, but their content is Truss's, so a new version has something to say about them. |
| **Reported, never written** | The **seed** files: `state/*`, `VISION.md`, `README.md`. `init` writes them once; after that they are your decision log, your phase plan, your vision. If the baseline changed one, you are told — nothing is merged into it. |
| **Never looked at** | `context/`, `HUMAN-TODOS.md`, `archive/`, your code root, and every other file the baseline never had. |

The seed/framework split is the one distinction that matters here. A template
diff line-merged into `state/decisions.md` would rewrite decided history, which
`AGENTS.md` §5 forbids outright; and where your file still equals the scaffolded
template, a naive upgrade would replace your phase plan with the new default
without so much as a conflict. Neither can happen: seed files are outside the
write set entirely.

## If you changed the engine yourself

Adapting the engine locally is a supported move, and the upgrade replaces every
one of those edits — that is what "swapped in by rename" means. So it says which
files it is about to take with it.

Each release writes `MANIFEST.sha256`: sha256 hashes of the engine's own files,
everything under `.truss/` except `out/`, `prompts/custom/` and the manifest
itself. Before the swap, `upgrade` compares the installed engine against it and
reports one of three things — no manifest to check against, a clean match, or
the files that diverged plus the backup directory to recover them from. Run it
with `--dry-run` first and you get that list while nothing has moved yet.

`doctor` reports the same divergence continuously as `ST-09`, at **info**: an
adapted engine is not a defect, it is a state worth knowing about before an
upgrade takes it away. An instance whose engine predates the manifest has
nothing to compare against, so nothing is checked and nothing is reported.

## How the reconciliation decides

The upgrade has both halves of a 3-way merge on disk without any bookkeeping:
an installed engine carries `.truss/baseline/`, which is *exactly* the files your
workspace was scaffolded from, at the version you installed. So for each file:

- **base** — `.truss.bak-<old>/baseline/<file>` (what you started from)
- **theirs** — `.truss/baseline/<file>` (what the new version ships)
- **mine** — `<file>` in your workspace

| Situation | What happens |
|---|---|
| baseline unchanged between the versions | nothing — most files, most releases |
| it is a seed file (`state/*`, `VISION.md`, `README.md`) | reported, never written |
| you never modified the file | taken from the new baseline |
| both changed, different places | merged (`git merge-file`) |
| both changed, same place | `<file>.truss-merge` written with conflict markers; **your file stays untouched** |
| the merge is clean but the result is structurally invalid (e.g. `package.json`) | treated as a conflict, not written |
| the file is binary | reported; never fed to a line merge |
| new file in this version | created |
| the file left the baseline | kept as yours — never deleted |
| you had deleted the file | not resurrected; the upstream change is reported, not applied |
| a write fails (permissions, disk) | that one file is reported as `FAILED`; the rest of the run continues |

Your workspace is bootable at every point of the run. Files are written
atomically, so no live file is ever half-written; no conflict markers land in a
live file; and the engine is staged next to the workspace and swapped in by
rename, so an interrupted run leaves the workspace exactly as it was — never an
install without an engine, and never a new `VERSION` on a half-copied tree that
the next run would mistake for an upgrade already done. Writes never follow a
symlink out of the workspace, so `git checkout .` really is the whole rollback.

`AGENTS.md` gets one special treatment. Its `truss:begin preferences` and
`truss:begin phase` blocks are machine-written, so the baseline ships
placeholders where your workspace has rendered content — left alone, that region
would conflict on every single upgrade, in the one file that matters most.
Instead the block bodies are excluded from the merge and your rendered content
is kept verbatim. `truss set` and `truss render` remain their only writers.

## The half a script cannot do

File content is only part of a version change. A release can retire a preference
key, change what a rule means, or move where something belongs — and whether a
new baseline rule even applies to your project is a judgment call. That is what
[`docs/rituals/upgrade.md`](rituals/upgrade.md) is for. Its standing
instruction is **keep, don't align**: your file drifted from the baseline because
someone decided it should, so the agent imports the baseline's *intent* into your
wording rather than restoring you to factory state.

Run `doctor` after any upgrade even when nothing conflicted. It is where the
semantic layer surfaces — a retired preference key is reported with its
replacement, ready to apply with `truss set`.

## If it goes wrong

```bash
git checkout .                       # your files, back to the commit you made
rm -rf .truss && mv .truss.bak-<old-version> .truss    # the engine, back to the old one
```

That is the whole rollback. Nothing else was modified.
