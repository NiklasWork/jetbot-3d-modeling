# Learnings

> Systemic weaknesses in how the work gets done — not a product bug log (AGENTS.md §2).
> Written when identified, not when fixed. Shape: docs/conventions.md.

## L-001 — A comparison package that names the tools presupposes the variable

Date: 2026-09-05
Trigger: Package 3 was written as "run `mapper` and `global_mapper` on the same images and keep the faster one that still registers everything". Measuring it showed the mapper is close to irrelevant: on the same 263 images the matcher moved the reconstruction from 12 k points to 81 k, while the two mappers stayed within a factor of 2.5 of each other. Had the package been executed as written, the pipeline would have been built around the wrong knob — and the recorded claim that motivated it ("one to two orders of magnitude faster") turned out false at our scale.
Systemic cause: The package was phrased as a tool question rather than an outcome question, and the tool pair came from a vendor claim the workspace had recorded but not tested. A `next:` entry that already names the two candidates reads as settled scope, so the obvious next step is to benchmark them rather than to ask what actually decides the outcome.
Adjustment: Phrase comparison packages by the outcome to be reached, not the candidates to be compared — "what makes the reconstruction succeed" rather than "A against B". When a package does name candidates, measure at least one stage on either side of them before accepting the framing. Claims imported from a paper or README are unmeasured until a row in context/measurements.md says otherwise.
Follow-up: Robot Package 3 and pipeline Package 6 are the next packages to read against this before they are executed.

## L-002 — Editing a script while a background instance of it is running

Date: 2026-09-06
Trigger: A long COLMAP run was started in the background from `repos/pipeline-3d/pipeline.sh` so the session could keep working. Two small defects in that same script were then fixed while it ran. Bash reads a script incrementally by byte offset and seeks back to the next command after each one returns — changing the file's length can resume the running instance mid-token. The run had to be killed and restarted to remove the uncertainty.
Systemic cause: The efficient habit — start the long job in the background, keep working — silently conflicts with the other efficient habit, fixing defects as soon as they are spotted. Nothing in the workflow flags the overlap, and the failure would not appear until the running process reaches its next command, long after the edit looks successful.
Adjustment: Before editing any file, check whether a background job is executing it. If one is, either wait, or copy the script to a scratch path and run the long job from the copy so the working tree stays editable. Interpreted files being executed are the case that matters — shell scripts, Python entry points — not data the job merely reads once at startup.
Follow-up: Cheap to obey once the pipeline has a stable script; it costs one `pgrep` before an edit.

## L-003 — A render accepted as proof of a transform

Date: 2026-09-09
Trigger: The rotation that stands room-niklas upright was first derived from an assumed Euler convention for `splat-transform -r`, then checked by rendering the rotated model and looking at it. The picture showed an upright room, so the value was reported to the human — and it was wrong by 32°: the sign of the x angle was inverted, and the frame it was rendered from carried the same inverted assumption, so the two errors cancelled in the image. A three-splat file put through the tool exposed the real convention (`Rz(+ez)·Ry(−ey)·Rx(−ex)`) in one command.
Systemic cause: A render is the most convincing artefact available and the least conclusive — a scene stays recognisable through tens of degrees, and any error shared by the transform and the camera that views it is invisible by construction. Nothing in the workflow demanded that a third-party tool's convention be measured rather than assumed, and "it looks right" reads as verification when the result is a picture.
Adjustment: Measure a tool's transform convention against a synthetic input with known basis vectors before trusting any angle derived for it, and verify the result on the artefact's own numbers — here, the dominant plane in the written `.sog`, which went from a wall 74° off to a floor 1.9° off. A picture may illustrate the finding; it may not be the check that establishes it.

## L-004 — A fix that lands only in a build output is not a fix

Date: 2026-09-09
Trigger: The deck's tilted model was corrected by rebuilding `presentation/assets/room.html` and `presentation/deck.html`. Both are gitignored build outputs. Nothing would have carried the correction: the recipe in context/presentation.md still had the old command, and a second session was at that moment editing the deck's sources and about to regenerate exactly those two files — the fix had a lifetime of minutes, and `git status` showed nothing to warn about it, because there was nothing to commit.
Systemic cause: The consistency rule reads "task done → write the follow-ups", which assumes the work itself is durable. When the deliverable is generated, the durable object is the generator — the recipe, the script — and the edited file is a copy that the next build discards. A clean `git status` after changing a file is the signal, and it looks like success.
Adjustment: After changing any file, check whether it is generated — `git check-ignore <path>` answers it in one command. If it is, the change belongs in whatever writes it, and the generated file is only evidence that the change works. Parallel sessions make this sharper, not different: they rebuild on their own schedule.

## L-005 — An index-based splice needs an assertion on what must survive, not only on what goes in

Date: 2026-09-09
Trigger: A patch to `presentation/deck.template.html` cut the text between two anchors and replaced it. The lower anchor had moved earlier in the same session, so the cut swallowed three unrelated script blocks — 9681 characters of working code — and the patch reported success, because everything it asserted about (the inserted text) was correct. It was recoverable only by accident: the last successful build still held the deleted code, and one of the assets it inlines could be reversed back into a placeholder.
Systemic cause: Splices are written to assert their intent and nothing else. `assert old in s` proves the anchors exist; it says nothing about what sits between them, which is exactly the part being destroyed. Editing by anchor is normal and fine — editing by two anchors whose distance nobody checked is not, and a file being an uncommitted work-in-progress removes the only safety net that would otherwise catch it.
Adjustment: When a patch deletes a span it did not print, assert on the span first — its length, or one string that must be inside it, or one that must survive outside it. And commit before a restructuring pass, not after: an uncommitted file has no undo.

## L-006 — One exception in one IIFE takes down every feature on the page

Date: 2026-09-09
Trigger: The deck's open-source slide calls its own initialiser at the end of its block, and that initialiser reads point-cloud data declared further down the same script. `var` hoisting made the name exist and be `undefined`, so the read threw, and the throw ended the whole immediately-invoked function: the status board, the opening point cloud and the keyboard navigation all silently did not exist. Each looked like its own separate bug.
Systemic cause: A single-IIFE page has no fault isolation. Unrelated features share one call stack and one failure, so the first thing that throws decides how much of the page runs, and the symptom appears far from the cause. Declaration order inside such a block is load-bearing in a way nothing in the code says.
Adjustment: In a page built this way, put shared data and helpers above every block that consumes them, and read the console before believing a rendering problem is a styling problem — a blank region and a dead keyboard in the same page are one bug, not two.
