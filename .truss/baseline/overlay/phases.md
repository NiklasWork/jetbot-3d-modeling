---
current: ingest
---

> Source of truth for phase definitions. `truss render` reads this file and writes the phase block in AGENTS.md.
> `current:` is the only line a human changes here; advancing it (a phase change) is human-only — see AGENTS.md §4 (phase exit procedure).
> The definitions below are the project's phase plan — drafted at kickoff from this seed, agent-maintained: restructure with a D-NNN + tell the human + `truss render`; hard limits in AGENTS.md §5.
> Overlay variant: used by `truss init --overlay` for an existing project. Replaces the core phase list.

## ingest

label: Ingest
purpose: take stock of the existing project — inventory code, docs, and decisions; import what matters.
behavior: archaeological — read before changing; capture current reality, defer redesign.
allowed: inventories, import notes, questions about the existing system, domain notes summarising findings.
forbidden: refactors, feature work, deleting existing files, premature redesign of the inherited system.
forbidden-globs: repo/**
read: state/profile.md
exit: file: context/import-log.md; existing system mapped and summarised (human); pursue/adjust decision recorded as D-entry (human)

## operate

label: Operate
purpose: run the ongoing work on the existing system — features, fixes, and iteration.
behavior: pragmatic — small reversible changes; keep state/current.md accurate; flag deviations as new D-NNN.
allowed: all development and iteration work; refactors with a recorded reason; documentation updates.
forbidden: silent large rewrites without a D-entry; skipping the session ritual; unbounded state/current.md next list (over 5).
read: state/profile.md, state/decisions-index.md, state/current.md
exit: ongoing-run criteria met (human); doctor clean (human); human sign-off (human)
