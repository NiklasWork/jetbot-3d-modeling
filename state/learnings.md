# Learnings

> Systemic weaknesses in how the work gets done — not a product bug log (AGENTS.md §2).
> Written when identified, not when fixed. Shape: docs/conventions.md.

## L-001 — A comparison package that names the tools presupposes the variable

Date: 2026-09-05
Trigger: Package 3 was written as "run `mapper` and `global_mapper` on the same images and keep the faster one that still registers everything". Measuring it showed the mapper is close to irrelevant: on the same 263 images the matcher moved the reconstruction from 12 k points to 81 k, while the two mappers stayed within a factor of 2.5 of each other. Had the package been executed as written, the pipeline would have been built around the wrong knob — and the recorded claim that motivated it ("one to two orders of magnitude faster") turned out false at our scale.
Systemic cause: The package was phrased as a tool question rather than an outcome question, and the tool pair came from a vendor claim the workspace had recorded but not tested. A `next:` entry that already names the two candidates reads as settled scope, so the obvious next step is to benchmark them rather than to ask what actually decides the outcome.
Adjustment: Phrase comparison packages by the outcome to be reached, not the candidates to be compared — "what makes the reconstruction succeed" rather than "A against B". When a package does name candidates, measure at least one stage on either side of them before accepting the framing. Claims imported from a paper or README are unmeasured until a row in context/measurements.md says otherwise.
Follow-up: Robot Package 3 and pipeline Package 6 are the next packages to read against this before they are executed.
