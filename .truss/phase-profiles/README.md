# Phase profiles

A phase profile is a ready-made `state/phases.md` for a project type whose
lifecycle is known in advance. A fresh `truss init` installs no lifecycle at all:
`.truss/baseline/state/phases.md` ships a single `kickoff` phase whose job is to
interview you into the phase plan this project actually needs. A profile is an
alternative starting point you copy over it.

All of them — core flow and profiles alike — are **seeds, not the plan**: the
kickoff interview tailors the installed phases to the project (rename, drop, split,
add), and agents keep maintaining the plan as requirements change (D-NNN + telling
the human; see AGENTS.md §5). Only advancing `current:` stays human-only.

| Profile | Phases | Use it when |
|---|---|---|
| `founders-thinking.md` | discover → validate → **concept** | The goal is to think an idea through, not build it. The flow ends in a concept dossier and an honest **pursue/park** call instead of a build. |

Everything else is covered by the two paths that already ship: the `kickoff`
interview for a new project, and the existing-project overlay (`ingest → operate`,
applied by `truss init --overlay`, in `.truss/baseline/overlay/phases.md`). A
founding or startup project needs no profile of its own — it differs from any
other project only in its domains (legal, brand, finance), which it creates on
demand under `context/`, not in a separate phase list.

## Adopting a profile

An agent may perform the switch (it's a phase-plan restructuring: D-NNN + telling
the human, AGENTS.md §5) — but setting `current:` stays human-only (§4). To switch
a workspace to a profile:

```bash
# 1. Copy the profile over the active phase list (review the diff first).
cp .truss/phase-profiles/founders-thinking.md state/phases.md

# 2. Set `current:` to the phase you are actually in (the profile defaults to discover).
# 3. Re-render the AGENTS.md phase block from the new list.
node .truss/bin/truss.mjs render

# 4. Sanity-check.
node .truss/bin/truss.mjs doctor
```

Each `prompts:` line ships empty — the shipped prompt library was removed
(D-065). A phase
whose `section:`/`file:` exit target doesn't exist yet because the project
hasn't reached that phase is expected and shows as PH-06 info (`I`), not a
warning; it upgrades to a warning once that phase becomes `current:`.
