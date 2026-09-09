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

## OD-003 — How autonomous should the capture drive become?

Opened: 2026-09-08
Context: D-006 made manual control mandatory and named a driving algorithm as an optional expansion, deferring its decision until the vertical slice has run once. That slice is not done — no plan-robot package has been accepted: 1, 2 and 5 are open, and 3 and 4 exist as code that has never touched hardware. The question is planned out in context/plan-driving.md but must not be decided yet; what it settles is how much of the capture motion the robot performs and therefore which packages of that plan are built.
Options:
- A: Semi-autonomous manoeuvres (recommended) — the human picks standpoints, the robot drives orbit, wall pass and panorama itself, later closing the loop on the wall pass with a trained regressor +best capture geometry reachable on this hardware, no training needed to start, leaves D-006 untouched, builds on `capture.py` rather than beside it / –never a claim of full autonomy; coverage and loop closure stay human
- B: Autonomous room loop — the robot follows walls at constant distance until it returns to its start, using OpenCV floor detection or a pre-trained indoor segmentation net as the free-space source +one continuous unattended drive, strong live overlay for the presentation / –a segmentation mask is not a distance to the wall, so constant-distance following needs image-plane heuristics that fail silently on shadows and reflections; and it still cannot tell when the room is covered, so it needs supervising anyway. The build cost is the smaller objection — jetson-inference ships pre-trained segmentation for exactly this stack, as D-012 already proves
- C: Trained reflex avoider on the `collision_avoidance` pattern — a ResNet-18 classifier drives forward until blocked, then rotates +the familiar JetBot path with a ready-made notebook / –learns exactly the motion 3DGS cannot use (straight approach plus spin, both parallax-degenerate), and the training data is room-specific so the presentation room needs its own
- D: Fixed open-loop patterns only — a manoeuvre library with no perception and no human trigger, started once and left to run +smallest possible build / –drifts without bound after a few metres and will drive into furniture; only honest inside a cleared area
- E: Nothing — manual control stays the only mode, D-006 unchanged +zero risk and zero cost, the expansion budget goes to object detection (D-012) or the Lenovo rollout instead / –the capture geometry stays as good as the human's keyboard technique, which is the quality input the whole pipeline rests on
Trade-offs: A and B share a manoeuvre and capture layer, so choosing A does not foreclose B — B is an upgrade of A's decision layer, not a rewrite. C shares nothing with either. Every option is reversible except the time spent; C is the one whose cost recurs per room. None of them can be evaluated before the vertical slice produces frames from this camera, which is also the open risk context/measurements.md names. Added 2026-09-09: the robot is shared hardware (VISION.md), and the options do not cost the same there. A adds one Python file and nothing else. B needs a segmentation model and its TensorRT engine cache on the shared card, though D-012 puts jetson-inference on the device anyway. C is the expensive one — a room-specific dataset on the card and hours of training that occupy the GPU and the robot exclusively, repeated for every new room.
Leaning: A — it assigns the robot exactly what this hardware is good at (repeatable short moves, settle-and-shoot discipline) and the human exactly what no algorithm can supply without odometry or a map (coverage, loop closure), and the human confirmed on 2026-09-08 that manoeuvre-level autonomy is what they want.
Needed from human: the go-ahead for A after plan-robot package 5 has produced a real reconstruction — or a different option if that run changes what looks feasible.
