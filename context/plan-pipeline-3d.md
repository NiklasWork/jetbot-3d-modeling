---
focus: Turn a folder of photos into a viewable 3D model — with one command, reproducibly
next:
  - Package 6 — Have someone else repeat the run from the README alone
  - Measure the JetBot's own frames through the pipeline once they exist
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

3. ✅ **COLMAP pipeline.** 251 of 251 registered on a sequential capture, undistorted pinhole images produced, both mapper runtimes in context/measurements.md.
   The comparison changed the answer it was asked for: **the matcher, not the mapper, decides whether a reconstruction succeeds**, and `global_mapper` is not faster at our scale. Defaults are sequential + incremental, with exhaustive matching as the named fallback.

4. ✅ **Chaining.** `repos/pipeline-3d/pipeline.sh` — folder in, model out, three resumable stages. 380 s end to end on 251 images.

5. ✅ **Compress and display.** `.ply` → `.sog` → self-contained `.html` at a pinned `@playcanvas/splat-transform@3.3.3`. Verified navigable in a browser.

6. **Prototype.** Everything in one command, described in the README.
   *Done when:* someone else can repeat it solely from the README. The README is written; the check is a human act, not one this side can self-declare.

## Capabilities not yet used

- **`splat-transform` can prune what the capture got wrong.** `--filter-floaters` removes the drifting artefacts typical of indoor scans, `--decimate-adaptive` cuts splat count by local error, `lod-meta.json` writes streamed levels of detail. Worth reaching for once real JetBot frames show which artefacts we actually get — guessing now would tune against the wrong scene.
- **`--matcher exhaustive` is the escape hatch and costs 847 s on 263 images.** It is what reproduces the published reconstructions. If the drive's own frames fail the registration gate, this is the first thing to try, before touching the mapper.

## Afterwards, not now

Fisheye images from the robot instead of cell phone photos · 3D placement of object labels from the poses in the model · draw camera trajectory as a line · rollout to the Lenovo.
