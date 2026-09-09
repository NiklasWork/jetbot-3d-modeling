# Open Decisions

> Briefings for undecided questions that block or shape work — including a challenge to a recorded decision (AGENTS.md §3).
> On decision → `D-NNN` in state/decisions/ with `Closes: OD-NNN`, then remove the entry here; no "DECIDED" tombstones. Empty is the correct state of a project with nothing undecided — never delete this file.
> `OD-NNN` sequential, never reused: the next free number is one above the highest `OD-NNN` here **or** in a `Closes:` line under state/decisions/.
> The entry shape below is a machine contract — `doctor`'s SY-03 parses the option lines, so keep it. Full grammar: docs/conventions.md.

<!-- Entry template — an OD is a briefing the human can decide from without reconstructing your analysis.

## OD-NNN — [question title]

Opened: YYYY-MM-DD
Context: [why this matters now, and what it blocks]
Options:
- A: [short label] — [what choosing it means] +[upside] / –[downside]
- B: [short label] (recommended) — [what choosing it means] +[upside] / –[downside]
- C: [short label] — [what choosing it means] +[upside] / –[downside]
- …: as many as the question actually has — two is the minimum, not the format
Trade-offs: [cross-cutting: cost, reversibility — only what the option lines don't carry]
Leaning: [which option and why, one line · or "none" plus what input would decide it]
Needed from human: [the decision or input you need]

Option lines are keyed (A:/B:/C:/…), label before the ` — `, then upside after `+` and
downside after `–`, separated by ` / `. There is no upper limit: list every option
that the question actually has — forcing a true three-way choice into a yes/no
hides the exact possibility that the human would have chosen. Mark at most one
option `(recommended)`, and only if `Leaning:` agrees. Keep the label short — it is
the click target. -->

## OD-004 — Collision data for walk mode, against the one-file promise

Opened: 2026-09-09
Context: The viewer only offers walk mode when it is handed voxel collision data; without it `isWalkAllowed` stays false and the mode's button is hidden, leaving orbit and fly. Fly's strafe sits behind pointer lock, which a viewer embedded in an iframe (the deck, an artifact) never gets — so on room-niklas there was no way to walk at all. `splat-transform --voxel-external-fill` writes the data in 5 s and, verified in the browser, walk mode then appears and click-to-walk works without pointer lock. The catch: it writes *two* files (`model.voxel.json` + a 3.4 MB `.bin`) and the viewer takes them by URL (`?collision=`), so `model.html` stops being the single file the README promises.
Options:
- A: leave it — the pipeline keeps emitting one self-contained file, walk mode stays unavailable +nothing to explain, nothing to carry / –the model can only be orbited and flown, and in an embed only rotated
- B: emit the voxel files beside the model (recommended) — one more `splat-transform` call in the compress stage, `model.html?collision=model.voxel.json` walks +cheap, reversible, no new machinery / –three files where the README promises one, and the plain `model.html` link silently has no walk mode
- C: inline the collision into the HTML — post-process the generated bootstrap JSON with a data URI, as presentation/build.py already does for the deck +one file *and* walk mode / –new machinery in the pipeline, +3.4 MB per model, and it edits a generated file the tool owns
Trade-offs: All three are reversible; B and C cost ~5 s of build time. C is the only one that keeps the demo's "one file, opened in a browser" claim true while making the room walkable, and it is also the only one that would give the university deck walk mode.
Leaning: B for the pipeline, because it changes nothing that exists; C only if the deck itself should become walkable — that is a presentation decision, not a pipeline one.
Needed from human: whether the pipeline emits collision data at all, and whether the deck's viewer should walk.
