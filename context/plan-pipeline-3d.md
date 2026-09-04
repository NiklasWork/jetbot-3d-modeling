---
focus: Turn a folder of photos into a viewable 3D model — with one command, reproducibly
next:
  - Package 3 — Exercise the COLMAP path, incremental against global mapper
  - Package 4 — Chain the steps into one command
  - Package 5 — Compress and display with pinned versions
blockers: none
---

# Plan pipeline-3d

> Belongs here: the path from today to the first prototype of the Mac branch. Not here: tool choice rationales (state/decisions/), robot work (context/plan-robot.md), measured numbers (context/measurements.md).

**Prototype reached when:** a folder with photos becomes a `.sog` through one command, which is navigable in the browser — without robot, without manual work in between.

Each package can be accepted individually. No package starts before the previous one passes its check.

1. ✅ **Tools executable.** COLMAP 4.1.1 via brew (without CUDA), Brush built from source, `@playcanvas/splat-transform` 3.3.3.
   *Done when:* all three start and output their version.

2. ✅ **Reference run.** A known public dataset through Brush. Numbers in context/measurements.md.
   *Done when:* real numbers replace the estimates from D-002. — Also delivered: quality curve over the training steps, and throttling settled by throughput normalisation because `pmset -g therm` is mute on Apple Silicon.

3. **COLMAP pipeline.** `feature_extractor` → `sequential_matcher` → mapper → `image_undistorter`. Run `mapper` and `global_mapper` on the same images and keep the faster one that still registers everything.
   *Done when:* over 90% of the images are registered, undistorted pinhole images are available, and both mapper runtimes are in context/measurements.md.

4. **Chaining.** A script that turns Package 3 and Package 2 into a pipeline: folder in, `.ply` out. Use the measured fast preset, not the Brush defaults — see the variant table in context/measurements.md.
   *Done when:* a single command processes a fresh folder end-to-end.

5. **Compress and display.** `.ply` → `.sog`, viewer, load model. Pin versions.
   *Done when:* the own model is navigable in the browser.

6. **Prototype.** Everything in one command, described in the README.
   *Done when:* someone else can repeat it solely from the README.

## Tool capabilities that change these packages

Found while measuring, not yet acted on:

- **`colmap global_mapper` exists in our 4.1.1.** GLOMAP — global instead of incremental structure-from-motion, by the COLMAP authors — was merged into COLMAP itself and its own repository marked deprecated. Same database in, same sparse format out, so it is a drop-in for the `mapper` step in Package 3. The paper claims one to two orders of magnitude faster at equal or better accuracy. Unmeasured here.
- **`splat-transform` 3.3.3 does far more than `.ply` → `.sog`.** `--filter-harmonics <0..3>` drops SH bands after training, `--decimate` / `--decimate-adaptive` reduce splat count, `--filter-floaters` removes the artefacts typical of indoor scans, `lod-meta.json` writes streamed levels of detail — and `.html` emits a self-contained viewer in a single file, which removes the need for any server for a demonstration.
- **PlayCanvas recommends staying under one million splats for mobile devices.** The reference run produces 1.28 M. Capping splats is therefore a viewer requirement, not only a speed lever.

## Afterwards, not now

Fisheye images from the robot instead of cell phone photos · 3D placement of object labels from the poses in the model · draw camera trajectory as a line · rollout to the Lenovo.
