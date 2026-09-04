# AGENTS.md

> Boot file.

<!-- truss:begin preferences -->
> Machine-written via `node .truss/bin/truss.mjs set <key> <value>` — never edit by hand.

| key | value | behavior |
|---|---|---|
| subagents | research | spawn a research subagent on a knowledge gap |
| clarify | ask | ask before acting |
| verify-inputs | on | validate handed-over claims |
| scope | balanced | match scope to the problem |
| auto-commit | suggest | propose commit messages |
| gate-advocate | on | spawn advocate at phase exit |
| branch-guard | strict | refuse work on a branch mismatch |
<!-- truss:end preferences -->

<!-- truss:begin phase -->
> Rendered 2026-01-01T10:00 from `state/phases.md` — edit there, then run `truss render`. Phase changes are human-only; propose via HUMAN-TODOS.md.

**Phase 1/2 — discover (Discovery)**
Purpose: explore the idea.
Behavior: divergent.
<!-- truss:end phase -->

## 1 Load order

1. This file.
2. `state/current.md`

## 2 Structure & routing

| Path | Owner | Purpose / what belongs here |
|---|---|---|
| AGENTS.md | A | router |
| README.md | H | human onboarding |
| VISION.md | H+A | problem and idea |
| HUMAN-TODOS.md | A→H | human todos |
| .gitignore | S | gitignore |
| CLAUDE.md · GEMINI.md · .cursorrules · .github/copilot-instructions.md | S | adapter stubs |
| state/map.md (on demand) | S | auto-generated domain map; read-only |
| state/current.md | A | current state |
| state/decisions.md | A | decisions |
| state/open-decisions.md | A | open decisions |
| state/phases.md | H pointer | phases |
| state/profile.md | H+A | profile |
| docs/conventions.md | A | conventions |
| docs/protocols.md | A | protocols |
| docs/git.md | A | git discipline |
| docs/import.md | A | import guide |
| .truss/ | S | engine |
| archive/ (on demand) | A | archive |
| repo/ (on demand) | H+A | codebase |
| pm/ · skills/ (on demand) | A | PM and skills |
| `<domain>.md` → `<domain>/` (on demand) | A | domain files |

## 3 Rules

Canonical truth: one file per fact.

## 4 Session protocol

Start, work, end.

## 5 Hard limits

Never change phase.

## 6 On-demand docs

Load when needed.
