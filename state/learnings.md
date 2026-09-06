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
