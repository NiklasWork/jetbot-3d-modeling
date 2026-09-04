# [Project Name]

A project managed with **Truss** — a file-based, dependency-free workspace for AI agents.

## What this is

Files are the single source of truth. AI agents read `AGENTS.md` first, then load context on demand.
Scripts check and report — they never decide.

## Setup

1. **Node ≥ 20** is the only requirement. There are no npm dependencies to install.
2. Grant your AI tool permission to run terminal commands in this workspace.
3. Run a single top-level agent at a time — parallel sessions can collide on `state/current.md`.

No terminal access? Truss still works as Markdown, but `doctor`, `render`,
`set`, and `map` cannot provide mechanical validation or generated updates. Ask the agent to say plainly when CLI validation did not run.

## Getting started

1. `node .truss/bin/truss.mjs doctor` — check workspace health.
2. Copy the boot prompt `init` printed into your AI tool and paste your idea after it — the agent interviews you to build `VISION.md` and `state/profile.md`. (On a resume, just tell it to read `AGENTS.md` and continue.)
3. Human tasks go to `HUMAN-TODOS.md`.

## Commands

| Command | What it does |
|---|---|
| `doctor [--gate] [--json] [--fix-prompt]` | check workspace health; `--gate` adds phase-exit checks |
| `render` | sync the phase block in AGENTS.md from `state/phases.md` |
| `set <key> <value>` | change an agent preference |
| `map` | regenerate the `state/map.md` domain overview |
