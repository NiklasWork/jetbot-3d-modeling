You are finishing a Truss version upgrade. `truss upgrade` already did the mechanical half — the engine is swapped and every unambiguous baseline change is applied. What is left is the half a script cannot decide: files where the new baseline and this project changed the same place. Done = every conflict resolved, no `.truss-merge` file left, `doctor` clean, and a one-paragraph report of what changed in how this workspace works.

## Your input

- Task: {{INPUT}} (optional — the versions, or which files to focus on)
- Constraints: {{CONSTRAINTS}} (optional)
- Pointers: {{POINTERS}} (optional — project-specific sections that must survive verbatim)

**Your default is to keep, not to align.** A file drifted from the baseline because someone decided it should. You are importing new framework rules into a project, not restoring a project to factory state. Write all free-text in the `language:` set in state/profile.md; ID tokens, keys/field labels and fixed headings stay English (AGENTS.md §3).

**1. Orient.** Read AGENTS.md and state/current.md. Find the backup the upgrade left as `.truss.bak-<old-version>/` — `.truss.bak-<old>/baseline/` is the version this workspace was scaffolded from, and `.truss/baseline/` is the new one. Those two directories are the *only* authority on what the upgrade wants to change; never diff the workspace against the new baseline alone, or you will read every deliberate project decision as drift.

**2. Take stock.** The upgrade report names three kinds of leftover, and they are not the same job:
- **`CONFLICT`** — a `<file>.truss-merge` sits next to an untouched original. Resolve it (stage 3) and delete the side file.
- **`manual` / `FAILED`** — nothing was written at all; the note says why (git missing, a binary file, a permission error). Fix the cause or merge by hand, then verify the file yourself.
- **`review`** — a **seed** file (`state/*`, `VISION.md`, `README.md`). The upgrade deliberately did not touch it: its content is the project's, not the framework's. Compare the two baseline versions and port only a *structural* change the project genuinely needs — a new field in `state/profile.md`, a new section heading. Never port template prose, and never let a template diff touch recorded entries in `state/decisions.md` (AGENTS.md §5: never delete a decision). When in doubt here, leave it and say so.

For each file, get the three versions clear in your head: yours (the workspace file), old baseline, new baseline.

**3. Resolve, hunk by hunk.** For each conflict, the question is never "which side is better" but **"what did the baseline change here, and does that change apply to this project?"**
- Compute the baseline's own intent first: old baseline → new baseline. That diff, and only that, is what you are importing.
- Apply that intent to the project's wording, keeping the project's terminology, its added sections, its `§2` table rows, its examples. A renamed rule gets renamed; a rewritten paragraph gets rewritten in the project's voice, not pasted from the baseline.
- Content the project added and the baseline never had: keep unconditionally.
- Content the baseline removed: remove it only if the project did not extend it. If it did, say so and ask.
- Never touch the generated blocks (`truss:begin preferences`, `truss:begin phase`) by hand — `truss set` and `truss render` own them (AGENTS.md §5).
- Anything you cannot decide from the three versions: ask. One question, with the three variants shown, beats a wrong merge in AGENTS.md.

**4. Land it.** Write the resolved content into the real file, then delete the `.truss-merge` file. No conflict markers may survive anywhere.

**5. Check the semantic layer.** File content is only part of a version change. Run `node .truss/bin/truss.mjs doctor` and treat every finding as an upgrade task: a `BL-03` warning about a retired preference key names its replacement in the message — apply it with `truss set`. Then run `truss render`, and `truss map` if the file inventory changed. Repeat until clean.

**6. Report.** In state/current.md, refresh `focus:` so it names the version step. To the human, one paragraph: which rules changed in how this workspace is run, what you kept against the baseline and why, and anything you had to guess. If the upgrade changed a rule that contradicts a recorded decision, open an `OD-NNN` — do not silently let the new baseline overrule a `D-NNN`.

Once `doctor` is clean and the human is satisfied, `.truss.bak-<old-version>/` can be deleted. Leave that to the human.
