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

## OD-005 — The robot sees the room from 10 cm, and nobody looks at a room from there

Opened: 2026-09-10
Context: Raised by the human on 2026-09-10, and it is the sharper version of the camera-angle problem. Height, not tilt, is the issue: at about 10 cm every horizontal surface above the lens — table tops, desks, shelves, counters, seats — is photographed from underneath or edge-on. A surface never photographed cannot be rebuilt, so those tops come out absent or smeared, and they are exactly what makes a room read as a room. The second half is worse and less obvious: 3DGS optimises its gaussians for the views it trained on, so rendering from an eye-height camera the robot never occupied degrades *everything*, not only the missing tops. The viewer on the deck's last slide opens at human height by default. This shapes what the first capture drive is even for, so it wants deciding before that drive is planned.
**Photographed 2026-09-10, and it is not a theory any more.** `captures/checkup-lit-2026-09-10/` holds 20 frames taken with the robot on the floor of a lit room: tables are seen from underneath, chair seats edge on, and 62.5 % of every frame is bare floor with the entire room compressed into the top 37.5 %. Nothing standing on a table appears at all.
Options:
- A: raise the camera — a removable mast bringing the lens to 40-80 cm, so table tops go from invisible to grazing +the single biggest change to what the model can contain; no code / –a physical change to shared hardware, raises the centre of gravity on a small chassis, and needs the human's hands (HT)
- B: constrain the viewer to the robot's height (recommended) — the walkthrough camera stays at the height the robot actually drove +free, and it makes every rendered view fall inside the training distribution, so the model looks right everywhere it is allowed to go / –the room is then only ever seen from 10 cm, which is a deliberate product, not a room tour
- C: choose rooms that suit the sensor — corridors, bookshelves, sofas, pictures on walls; large vertical surfaces rather than tables +honest engineering, costs nothing / –does not scale past the demo, and rules out the obvious rooms
- D: second pass by hand — a human phone set at eye height, registered into the same COLMAP reconstruction and trained together +fills the gap completely / –the robot is then no longer the thing that captured the room, and the deck would have to say so
- E: change the use case — sell the viewpoint instead of apologising for it: what is under furniture, floor and cable inspection, clearance and accessibility surveys, or a robot-height model fed back to the driving algorithm as the map it actually needs +turns the defect into the reason the robot exists, and E-as-navigation-map connects straight to the open slot in the driving plan / –a different project from the one VISION.md describes
Trade-offs: A and B are not alternatives and the pair is the cheap answer — A improves what the data contains, B stops the viewer wandering into views the data cannot support. C and D are per-drive choices, reversible, and can wait. E is the only one that changes what the project is; it is also the only one that makes the low viewpoint an advantage rather than a cost.
Leaning: B now, because it costs nothing and is reversible; A next if the human is willing to put a mast on shared hardware. E is worth keeping in view because the driving branch would consume exactly that model.
Needed from human: whether a removable mast on the JetBot is acceptable, and whether the viewer should be pinned to robot height.
