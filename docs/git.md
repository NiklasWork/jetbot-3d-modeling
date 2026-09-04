# Git

> Load when: before the first commit of the session, or when working with overlay git.
> Defines commit discipline and overlay git mechanics.

## Commit format

```
<area>: <action> — <context>
```

- **area**: file group or feature (e.g. `state`, `docs`, `agents`, `repo/auth`, `dashboard`)
- **action**: imperative verb phrase (e.g. `add D-003 tech stack decision`, `fix phase block timestamp`)
- **context**: why or what changed (one clause; omit if the action is self-explanatory)

Examples:
```
state: add D-003 tech stack decision — chose TypeScript over Go for team familiarity
agents: update phase block to validate — discover exit approved
docs: add conventions entry grammar for OD-NNN
repo/auth: implement JWT refresh — covers expired-token edge case
```

Keep the subject line under 72 characters. Body is optional; use it for breaking changes or migration notes.

## When to commit

- After each logical unit of work (a decision, a completed task, a phase advance).
- Never in the middle of a refactor — leave the tree clean.
- **Stage by path.** `git commit -- <the paths you changed>` commits exactly those paths — verified: it leaves out a file another session has already *staged* in the shared index. A pathless `git add -A` / `git add .` takes whatever else is in the tree, including work that has not been reviewed yet. `truss status` names the paths that were already uncommitted when your session began.
- With `auto-commit: suggest`, the agent proposes the message; you run `git commit`.
- Without an `auto-commit` directive (default), commit behaviour follows your host agent's own rules.

The agent only runs `git commit` itself when `auto-commit: on` is set.

## Several sessions in one tree

Two agent sessions in the same working tree share one index and one HEAD. `truss status` reports what it can see — how many sessions are live, which paths were already uncommitted when yours began, and what moved since your last run.

**`.git/index.lock` is not damage.** Concurrent git commands do not corrupt anything; the loser fails loudly with `Unable to create '.git/index.lock': File exists`. Git's own message then suggests removing the file by hand — that advice is written for one person at one machine. With another session in the tree, deleting the lock destroys the other process's write. Wait a couple of seconds and repeat your command instead; after three tries, say so and continue without committing.

## Overlay git

Some projects use Truss to manage an *existing* repository. The model is **nested**: the Truss workspace is the outer directory with its own git history, and the existing code lives under `repo/` inside it, keeping its own history. In this setup:

- `repo/` (a clone or a symlink) holds the existing codebase; `.gitignore` lists `repo/`, so the workspace never tracks or commits it.
- The workspace and the repo therefore have **separate** git histories — they cannot mix.
- Commits to `repo/` follow the repo's own conventions; workspace commits follow this file.
- Never stage workspace state files and repo source files together (the gitignore makes this the default, not just a rule to remember).

**To set up overlay git:**

1. Place the code under `repo/` yourself: `git clone <url> repo/` or `ln -s /path/to/code repo`. `init --overlay` prepares the workspace but never places the code.
2. Confirm `repo/` is in `.gitignore` (overlay init adds it).
3. Document the overlay structure in state/profile.md under Tools.
4. Note in docs/import.md which files were imported and from where.

### Placing repo/ — symlink, clone, or submodule

Three ways to put the existing code under `repo/`. The first two keep histories **separate** (the overlay default); the third deliberately couples them and is advanced.

| Option | How | repo/ in `.gitignore`? | Use when | Watch out |
|---|---|---|---|---|
| **Symlink** (default for local code) | `ln -s /path/to/code repo` | yes | the code already lives on your machine and you want one working copy | Windows symlink friction; the symlink's branch *is* your real checkout's branch |
| **Clone** (default for remote code) | `git clone <url> repo/` | yes | you want a self-contained workspace, or the code is remote | a second checkout to keep in sync with origin |
| **Submodule** (advanced) | `git submodule add <url> repo` and **remove `repo/` from `.gitignore`** | no — the workspace tracks a pinned commit | you want the workspace to *pin/version* the exact repo commit (reproducible doc snapshots, release workspace+code together) | re-couples the histories (a gitlink SHA in workspace commits) — the opposite of the overlay's separation; adds submodule ceremony (`git submodule update`). Don't reach for this unless you specifically need the pin |

Recommendation: prefer **symlink** (code in place) or **clone** (self-contained). Use a **submodule** only when pinning the repo version is an explicit goal — it trades the overlay's clean separation for reproducibility. (The Truss *source repo* itself uses a submodule for the engine; that is a packaging choice for the framework, not the model for your overlay.)

## Tags and branches

- Tags: `truss/phase-<name>-exit` when a phase is approved (human tags after HT is checked off).
- Branches (workspace): conventions don't prescribe a branch strategy — follow whatever is in state/profile.md.
- Branches (overlay `repo/`): the checked-out branch is part of the current reality. Declare it in `state/current.md` `branch:`; `truss status` compares it against the live checkout and flags a mismatch (`branch-guard` preference). For genuinely parallel work on several branches, prefer git **worktrees** (a separate `repo/` checkout per branch/focus) over flipping one checkout back and forth.
