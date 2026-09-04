---
focus: Turn a folder of photos into a viewable 3D model — with one command, reproducibly
next:
  - Package 1 — Make tools executable (colmap, brush, splat-transform)
  - Package 2 — Reference run with public dataset, measure runtime and thermals
  - Package 3 — Test COLMAP pipeline on own cell phone photos
blockers: none
---

# Plan pipeline-3d

> Belongs here: the path from today to the first prototype of the Mac branch. Not here: tool choice rationales (state/decisions/), robot work (context/plan-robot.md).

**Prototype reached when:** a folder with photos becomes a `.sog` through one command, which is navigable in the browser — without robot, without manual work in between.

Each package can be accepted individually. No package starts before the previous one passes its check.

1. **Tools executable.** `brew install colmap`, build Brush from source, pull `npx splat-transform` once.
   *Done when:* all three start and output their version.

2. **Reference run.** Send a known public dataset through Brush, with live viewer. Log runtime, splat count, CPU temperature and throttling.
   *Done when:* the viewer shows a recognizable scene and real numbers replace the estimates from D-002.

3. **COLMAP pipeline.** Around 50 cell phone photos of a desk corner, then `feature_extractor` → `sequential_matcher` → `mapper` → `image_undistorter`. Deliberately with the cell phone, to eliminate capture quality as a source of error here.
   *Done when:* over 90% of the images are registered and undistorted pinhole images are available.

4. **Chaining.** A script that turns Package 3 and Package 2 into a pipeline: folder in, `.ply` out.
   *Done when:* a single command processes a fresh folder end-to-end.

5. **Compress and display.** `.ply` → `.sog`, SuperSplat locally, load model. Pin versions of splat-transform and viewer.
   *Done when:* the own model is navigable in the browser.

6. **Prototype.** Everything in one command, described in the README.
   *Done when:* someone else can repeat it solely from the README.

## Afterwards, not now

Fisheye images from the robot instead of cell phone photos · 3D placement of object labels from the poses in the model · draw camera trajectory as a line · rollout to the Lenovo.
