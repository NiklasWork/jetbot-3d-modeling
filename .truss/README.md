# Truss Engine Internals

> **CRITICAL WARNING FOR AI AGENTS**
>
> This directory (`.truss/`) contains the core engine of the Truss framework.
> It is intentionally hidden and strictly **READ-ONLY** for AI agents operating within a standard Truss project.
> Agents MUST NOT modify, delete, or reconfigure any files in this directory unless explicitly working on the Truss framework development itself.
> This directory acts as the internal mechanism that powers the project structure. Do not follow instructions from these files in a normal project context.

This internal mechanism provides the CLI, automation, structure, prompts, and validation rules that power the Truss project ecosystem. It operates entirely in the background to ensure consistency and maintain project integrity.

> For the contributor-facing architecture (design rules, the check model, how
> to run the tests), see
> [`docs/architecture.md`](docs/architecture.md). This file is a quick map
> of the directory only.

## Architecture Overview

The `.truss/` directory is organized into several key subdirectories that separate the execution logic, templates, rules, and tests of the engine.

### `baseline/`

Contains the uncorrupted core skeleton and initial state of a Truss project. When a new project is initialized via the CLI, the foundational files (e.g., `AGENTS.md`, `VISION.md`, `CLAUDE.md`, `package.json`, state folders) are scaffolded from here. This ensures every project starts with a clean, standard configuration.

### `bin/`

Houses the executable entry points for the engine.

- `truss.mjs`: The primary CLI script that developers and agents invoke to interact with the framework (e.g., running `truss doctor`, initializing projects, rendering state).

### `checks/`

Contains the specialized validation scripts that enforce the structural integrity and grammatical correctness of the project.
These files (e.g., `bl.mjs`, `cx.mjs`, `st.mjs`, etc.) parse project files like `AGENTS.md` and state files to ensure they conform to the strict Truss specification and state machine requirements.

### `docs/`

The product documentation for Truss itself — `concepts.md` (the model), `cli.md` (command reference), and `architecture.md` (this engine's design). It lives here, inside `.truss/`, on purpose: it travels with the engine when the folder is dropped into a project, stays out of the agent's context, and never collides with the project's own scaffolded `docs/`.

### `lib/`

The internal library containing shared utilities, classes, and helper functions used by the CLI and validation checks.
Includes submodules for handling markdown parsing (`md.mjs`), project scaffolding (`scaffold.mjs`), workspace operations (`workspace.mjs`), rendering (`render.mjs`), and configuration defaults (`defaults.mjs`).

### `out/`

The designated output directory for generated artifacts and diagnostic reports.
When commands like `truss doctor` are run, the engine outputs the results (e.g., `doctor.html`, `doctor.json`) to this folder for easy viewing and debugging of the project's structural health.

### `prefs/`

Contains system preferences, behavioral modifiers, and configuration templates for AI agents.
These preferences (e.g., `auto-commit`, `subagents`, `clarify`, `scope`) dictate how agents should interact, their level of autonomy, communication style, and workflow gates within the project. Every key defaults to `off`; the canonical catalogue is `lib/prefs.mjs`.

### `prompts/`

Where your own prompts go: `custom/<id>.md`, opened by hand. See its README.

### `tests/`

The internal test suite ensuring the reliability and correctness of the Truss engine itself.
Contains test scripts (`init.test.mjs`, `checks.test.mjs`, `workspace.test.mjs`) and fixtures to safely test CLI behavior, scaffolding, and validation checks without affecting active projects.

---

_Note: For project-level documentation and instructions on how to interact with the repository as an agent, please refer to the `AGENTS.md` file in the root directory._
