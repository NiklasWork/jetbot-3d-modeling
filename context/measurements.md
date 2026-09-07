# Measurements

> Belongs here: measured runtimes and sizes on real hardware, with measurement conditions, and the protocol future measurements follow. Not here: tool choice rationales (state/decisions/), planning (context/plan-*.md).

Numbers taken from the research phase are replaced by measured ones here. What is written here has been verified; what is in a decision and missing here, is not.

## Setup

MacBook Air M4, 10 CPU cores, 24 GB, **fanless**, macOS 27. Brush `brush-cli 1.0.0` from source at commit `8b7f5c6`, release build. Dataset `tandt/truck`: 251 images at 979×546, COLMAP poses shipped with the dataset — **no SfM step is inside any of these numbers.**

Two traps had to be disarmed first, both of which had already corrupted an earlier measurement:

- **Brush prints nothing without a terminal.** Its progress UI is `indicatif`, which disables itself when stdout is not a TTY; no pty is available here (`script` fails with `tcgetattr/ioctl: Operation not supported on socket`). Runs therefore log through `RUST_LOG=info`, which yields per-eval PSNR/SSIM, per-refine splat counts and timestamps.
- **The CubeCL autotune cache is keyed by tensor shape** (`~/.cache/cubecl`). A configuration that changes a shape — a different `--sh-degree` above all — pays the kernel-search cost *inside* the measured run. Warm the cache per configuration before measuring, or the number is a cold-start number.

    RUST_LOG=info /usr/bin/time -l brush <dataset> \
      --total-train-iters 8000 --export-every 8000 --eval-split-every 8

## Reference run and its repeat

Same flags, 75 minutes apart, `base2` at the end of a series of five back-to-back runs on a fanless machine.

| Quantity | `base` | `base2` |
|---|---:|---:|
| Training, 8000 steps | 974 s | 986 s |
| Wall clock incl. load and export | 992 s | 1004 s |
| Peak resident set size | 2.13 GiB | 1.85 GiB |
| Splats | 1,279,868 | 1,280,046 |
| `.ply` | 288.1 MiB | 286.6 MiB |
| `.sog` | 19.09 MiB | 19.02 MiB |
| PSNR at 8000 | 25.11 | 25.14 |

**Runtime is reproducible to 1.2 %, quality to 0.03 dB.** Continuous GPU load across more than an hour produced no measurable thermal degradation on this machine — a hypothesis that the series was drifting thermally is refuted by this pair. The tolerance band for accepting any future comparison is therefore ±3 %.

Build of Brush from source, once: 13 min 58 s. Conversion `.ply` → `.sog`: 59 s / 67 s. Compression factor **15.1**, confirmed on both runs.

CPU time is 64 s user against 974 s wall: the work is on the GPU via Metal, the CPU only feeds it.

### Quality over training steps

Eval split every 8th image: 32 eval views against 219 training views.

| Steps | PSNR | SSIM | Splats | Cumulative |
|---:|---:|---:|---:|---:|
| 1000 | 21.52 | 0.774 | 255 k | 0:50 |
| 2000 | 23.04 | 0.827 | 452 k | 1:56 |
| 3000 | 23.94 | 0.855 | 666 k | 3:38 |
| 4000 | 24.32 | 0.866 | 856 k | 5:50 |
| 5000 | 24.65 | 0.873 | 976 k | 8:23 |
| 6000 | 24.79 | 0.878 | 1.10 M | 11:21 |
| 7000 | 24.95 | 0.881 | 1.22 M | 14:35 |
| 8000 | **25.11** | 0.885 | 1.28 M | 16:14 |

**The second half of the run costs half the time and buys 0.46 dB.** Step 4000 reaches 97 % of the final PSNR in 36 % of the time. Cost per 1000 steps climbs from 50 s to 194 s, tracking splat count, and never levels off because `growth_stop_iter` is clamped to `total_train_iters` (`crates/brush-train/src/train.rs:150`) — at 8000 steps the model grows until the last iteration and never consolidates.

### Throttling

Normalised to splat count, time per step per splat holds at roughly 0.17 µs across the whole run and falls in the final segment; and `base2` matches `base` after an hour of load. `pmset -g therm` returns no `CPU_Speed_Limit` on Apple Silicon, so this replaces a thermal sampler. **Not throttling-free in general** — it says that this workload, at this length, on an open machine in room air, does not throttle measurably.

## Variants — one lever each, 8000 steps unless noted

Validated by the `base`/`base2` pair above, so these differences are real and not drift.

| Run | Lever | Training | vs base | PSNR | Splats | `.sog` | Peak RSS |
|---|---|---:|---:|---:|---:|---:|---:|
| `base` | — | 974 s | — | 25.11 | 1.28 M | 19.1 MiB | 2.13 GiB |
| `res640` | `--max-resolution 640` | 819 s | −16 % | 25.66 ¹ | 1.1 M | 16.0 MiB | 1.69 GiB |
| `cap400k` | `--max-splats 400000` | 736 s | −24 % | 24.58 | 400 k | 7.8 MiB | 1.10 GiB |
| `sh1` | `--sh-degree 1` | 1575 s ² | +62 % ² | 24.85 | 1.28 M | 19.0 MiB | 1.20 GiB |
| `fast` | 5000 steps, 800 px, 400 k cap, SH 2 | **289 s** | **−70 %** | 24.37 ¹ | 400 k | **6.8 MiB** | 0.93 GiB |

¹ Measured against downscaled eval images. PSNR is **not comparable across different `--max-resolution` values** — a smaller target is easier to fit. Only `cap400k` and `sh1` can be read against `base` directly.
² Cold autotune cache for the 4-coefficient SH layout, inside the timed run. The real cost of the flag is about 6 % — see below.

What this says:

- **Steps are the only lever with a near-linear effect.** Everything else is sublinear: a 3.2× splat cut buys 24 % time, a 2.3× pixel cut buys 16 %.
- **Splat count governs delivery size, not runtime.** `cap400k` is 2.4× smaller on disk for 24 % less time — and lands under the one-million-splat ceiling PlayCanvas names for mobile devices, which the baseline exceeds.
- **`--sh-degree 1` is not a lever at all.** The 62 % in the table is a cold-cache artefact, not the flag — see the short-run session below. With the cache warm it costs about 6 % runtime and 0.27 dB, and it does not shrink what we actually ship: the `.sog` stays at 19.0 MiB against the baseline's 19.1 MiB, because SOG compresses the higher SH bands away regardless. Only the intermediate `.ply` halves, and that file is not delivered. Leave SH at 2 or 3.
- **Combined, `fast` gives 3.4× the speed and a third of the delivery size** for roughly 0.7 dB. Do not reach for SH degree below 2 to get there.

## Short-run session — 2026-09-04, 21:49

Machine open, ventilated, in room air. 1000 steps per run, `--eval-every 250`, no export. Question: is `--sh-degree 1` genuinely slower, or was its 62 % a cold cache?

The A-B-A sandwich **discarded its own session**, exactly as intended: back-to-back with no gaps, the two baseline runs came out 39 s and 51 s, 28 % apart against a 3 % threshold. Across five consecutive sub-minute runs the times drifted upward from 33 s to 51 s while load average stayed between 1.7 and 3.0.

**Short runs are more sensitive to thermal state than long ones, not less** — the inverse of what the first version of this protocol assumed. A cold GPU boosts for the first seconds and then settles to its sustained clock; a 16-minute run is almost entirely sustained clock and averages the boost away, which is why `base` and `base2` agree to 1.2 % across 75 minutes. A 40-second run is largely boost phase, and how much of it a run gets depends on what ran immediately before.

Inserting **90 s of idle before each run** removes the effect completely:

| Pair | Order | `base` | `--sh-degree 1` |
|---|---|---:|---:|
| Warm-up, no gaps | base first | 33 s | 35 s |
| Confirmation, 90 s gaps | sh1 first | 33 s | 35 s |

Both orders, both to the second. **The 62 % was the cold autotune cache; the flag itself costs about 6 %** and 0.27 dB at step 1000 (PSNR 21.24 against 20.95), matching the 0.26 dB seen at 8000 steps.

## Structure from motion — 2026-09-05

COLMAP 4.1.1 (Homebrew, no CUDA), SIFT on the GPU via OpenGL, machine open and ventilated. Within each pair both mappers read the byte-identical database, so the comparison is fair by construction; the ±3 % band is irrelevant here, the differences are far larger. `drjohnson` is Deep Blending (indoor, handheld stills), `truck` the same 251 images every Brush number above uses.

| Images | Matcher | Match | Mapper | Map | Registered | Points | Obs/image | Reproj |
|---|---|---:|---|---:|---|---:|---:|---:|
| drjohnson, 263 | sequential | 42 s | global | 17 s | 262 | 12,175 | 175 | 0.44 px |
| | | | incremental | 16 s | **71**, of 9 fragments | 8,389 | 437 | 0.41 px |
| drjohnson, 263 | exhaustive | **847 s** | global | 53 s | 263 | 64,068 | 1,123 | 0.76 px |
| | | | incremental | 123 s | 263 | **81,175** | **1,309** | **0.56 px** |
| truck, 251 | sequential | 30 s | global | 105 s | 251 | 59,647 | 1,386 | 0.41 px |
| | | | incremental | 53 s | 251 | 55,870 | 1,367 | 0.43 px |

Feature extraction never matters: 11–15 s for 250–263 images at ~10,000 SIFT features each.

**The published drjohnson reconstruction has 80,861 points at 0.563 px.** Exhaustive matching with the incremental mapper reproduces it to within 0.4 % — that row is the right answer, and the yardstick for the rest.

- **The matcher decides whether the reconstruction succeeds; the mapper does not.** Sequential matching on drjohnson yields 12 k points where exhaustive finds 64–81 k. No mapper repairs a thin graph.
- **Sequential matching is valid only for a genuine sequence.** Perfect on truck, a video, in 30 s. It fails on drjohnson, handheld stills whose numbering has gaps. D-009 chose it for the video case and holds — the precondition is now measured rather than assumed, and a stop-and-go drive (D-013) meets it.
- **The "one to two orders of magnitude" claim for `global_mapper` does not hold at our scale.** It is 2× slower than incremental on truck and 2.3× faster on drjohnson — a factor of 2.5 either way. GLOMAP's speedup is against incremental on large unordered collections, not 250 ordered frames.
- **`global_mapper` is the robust one, `mapper` the accurate one.** Off a thin graph global registers 262 of 263 while incremental shatters into nine fragments; off a good graph incremental returns 27 % more points at 26 % less reprojection error. Global's robustness is partly false comfort — its 262 images rest on 175 observations each, a seventh of a healthy reconstruction, so they are registered but barely constrained.
- **Exhaustive matching costs more than training.** 847 s against 289 s for a whole `fast` run. Fallback, not default.

`pipeline.sh` therefore defaults to sequential + incremental and aborts with the fallback named when the graph turns out thin.

### Indoor, through the whole pipeline

Deep Blending's two indoor scenes, run through `pipeline.sh` as a user would.

| Dataset | Matcher | Registered | Whole run | `.sog` |
|---|---|---|---:|---:|
| playroom, 225 | sequential | 171 (76 %), 1 model | 3 min 28 s | 6.0 MiB |
| drjohnson, 263 | sequential | 71 (26 %), 8 fragments | aborted at the gate | — |
| drjohnson, 263 | exhaustive | **263 (100 %), 1 model** | 7 min 5 s ¹ | 6.8 MiB |

¹ Most pairs were already in the database from an interrupted attempt. Cold, add the ~14 min of exhaustive matching: about 20 minutes.

**The documented recovery works.** drjohnson fails the gate on the defaults and passes it completely on the retry the error message prescribes — the same 263 of 263 the standalone benchmark reached. playroom clears 70 % on sequential matching alone, so indoor handheld stills are not uniformly hostile to it; drjohnson's numbering gaps are.

**Indoor models come out hazy, and `--filter-floaters` does not fix it.** The drjohnson model is recognisable — pictures, chair, rug, floorboards — but large translucent splats sit in front of the scene and the viewer's opening camera starts inside them. At its default `0.05,0.1,0.004` the filter removed 0.5 % of the file (7.14 → 7.10 MiB) and changed nothing visible: this haze is not disconnected floaters but big low-opacity splats that do overlap the geometry. Untested hypothesis, worth one run when it matters: the `fast` preset's 400 k cap under-resolves white indoor surfaces, and `full` would tighten them. Not worth tuning against someone else's living room — the scene to tune against is ours.

### The whole pipeline end to end

`pipeline.sh` on the raw truck images with its defaults — sequential matcher, incremental mapper, `fast` preset. No poses from the dataset: COLMAP recomputed them.

| Stage | Time | Result |
|---|---:|---|
| sfm | 99 s | 251 of 251 registered, one model, undistorted pinhole images |
| train | 254 s | 400 k splats, `model.ply` 57.98 MiB |
| compress | 27 s | `model.sog` 6.78 MiB, `model.html` 11.90 MiB |
| **total** | **380 s** | one command, one folder in |

**Six and a half minutes from a folder of photos to a model that orbits in a browser.** Adding real SfM to the `fast` preset costs 99 s, a third of the training time — the block that was assumed to dominate is the smaller one. The `.html` output is the PlayCanvas SuperSplat viewer with the model inlined, so the demonstration needs no server at all; conversion to `.sog` is 27 s here against 59–67 s for the baseline's 288 MiB `.ply`, tracking file size.

### Phone stills, and what the `--probe` mode is really worth — 2026-09-08

The first dataset from our own capture rather than a public one: 372 iPhone stills of a
room, **4032×3024**, one continuous walk, one lens, nothing deleted. Every number above
comes from images of 979×546 or smaller, so this is the first look at what full-resolution
input costs. Same machine, `fast` preset, sequential + incremental.

| Stage | Full res, 4032 px | `--probe`, capped at 1000 px |
|---|---:|---:|
| Feature extraction | 5.12 min | 4.28 min |
| Matching | 5.24 min | **0.58 min** |
| Mapper | 7.00 min | 4.10 min |
| Undistortion | 3.58 min | skipped by design |
| **SfM total** | **~21 min** | **9.0 min** |
| Registered | 330 of 372 (88 %), 1 model | 296 of 372 (79 %), 2 models |

**Full-resolution stills are decode-bound, not compute-bound.** Capping the extractor at
1000 px is a 16× cut in pixels processed and buys 16 % — because COLMAP still reads and
JPEG-decodes 372 twelve-megapixel files either way. That floor is what the probe cannot
get under, and it is why the probe saves 12 minutes of 21 rather than the bulk of it.
`--FeatureExtraction.max_image_size` defaults to **-1** in COLMAP 4.1.1, no limit — an
earlier assumption that COLMAP downsamples to 3200 px on its own is wrong for this version.

**The one place the resolution lever works is matching: −89 %.** Fewer features per image
means quadratically fewer descriptor comparisons per pair.

**The probe's verdict is conservative, which is the right direction.** 79 % across two
models against the full run's 88 % across one: it passes its own gate, and it under-reports
rather than over-reports. A probe that flatters a dataset would be worse than none.

**Consequence for capture, and it outranks the probe:** downscale the source images once
before any of this. The JetBot delivers 1280×960, so this is a phone-only tax — but for a
phone test set, `sips -Z 1600` up front removes the decode floor from every stage at once
and leaves reusable output, which the probe never does.

**Unexplained, and now the dominant cost:** `splat-transform`'s `.sog` → `.html` step took
**15 min 21 s** here, against 27 s for both conversions together on `truck`. Same version,
same 400 k splats, and the `.ply` → `.sog` step was normal at 25 s. Total run 42 min, of
which Brush's own timer claims only 258 s. Not reproduced yet — one repeat of the compress
stage alone would settle whether this is data-dependent k-means convergence on a hazy
indoor scene or an artefact of that particular run.

**One bug found and fixed by this run.** `pipeline.sh` treated the existence of
`undistorted/sparse/` as proof that undistortion had finished, but COLMAP creates that
directory when it starts and writes the model into it at the end. An undistortion that was
still running looked finished to the next invocation, which then skipped SfM and handed
Brush a dataset with no poses — `Format not recognized`. The check is now the model file.

## Measurement protocol

Three false conclusions came out of this project's measurements before this protocol existed: background load with a cold cache, then a laptop that spent part of a series inside a cotton bag, then a cold cache inside a timed run. Future measurements follow this.

**Physical setup, fixed and stated.** Open, on a hard surface, in room air, never on fabric or in a bag. Power connected. No lid closing, no moving the machine mid-series. If the setup changes, the series is over.

**Record the load, do not gate on it.** An absolute threshold is the wrong control: with the desktop app running, this machine idles at a load average around 2.5, so any threshold low enough to be meaningful would block every measurement. Log `sysctl -n vm.loadavg` at the start of each run — the runner does — and let the sandwich below catch what matters.

**Idle 90 s before every timed run.** Non-negotiable for runs under a few minutes; this is the single change that took the spread from 28 % to zero. Long runs need it less, but it costs nothing there either.

**Warm the cache per configuration.** Any configuration that changes a tensor shape (`--sh-degree`, `--max-resolution`) gets one discarded run over the same step range first. The kernel search otherwise lands inside the measurement, which is worth up to 62 %.

**Sandwich every comparison.** Run A, then B, then A again, in one sitting. If the two A runs differ by more than 3 %, discard the whole session rather than explaining the difference. This catches thermal drift, background load and cache effects at once, without needing to identify which one occurred — and it did.

**1000 steps is enough for a comparison.** Splat counts agree to 1.3 % between configurations at step 1000, and dropping the first 250 steps removes dataset loading and startup from the window. Extrapolate to full length through the recorded curve; do not re-measure it.

**Separate what temperature can touch from what it cannot.** PSNR, SSIM, splat counts and file sizes are deterministic at a fixed seed and survive any thermal condition — the `base`/`base2` pair agrees to 0.03 dB. Only durations need any of this.

## What this corrects in the decisions

| Claim | Origin | Finding |
|---|---|---|
| "~6 min for 8000 steps" | D-002 | **false** — 974 s and 986 s on two runs |
| "~92 % of full quality" | D-002 | **measured** — 97 % of final PSNR at step 4000 |
| Switch `--total-steps` | D-002 | **false** — is `--total-train-iters` |
| Manual downsampling needed | D-002 | **obsolete** — `--max-resolution` does it, default 1920 |
| `.sog` 15–20× smaller than `.ply` | D-004 | **confirmed** — factor 15.1, twice |
| Conversion "~15 sec" | D-004 | **false** — 59 s and 67 s |
| `npx splat-transform` | D-004 | **false** — package is `@playcanvas/splat-transform` |
| Viewer needs a hosted container | D-004 | **not for a demo** — `splat-transform` emits the SuperSplat viewer as one self-contained `.html`; hosting only matters for the takeaway link |
| `global_mapper` "1–2 orders of magnitude faster" | plan-pipeline-3d | **false at our scale** — within a factor of 2.5 of `mapper`, in both directions |

## Open

- **No number here comes from our own camera.** Every dataset measured is DSLR-quality, well lit, high overlap. The JetBot delivers 1280×960 rolling-shutter fisheye frames of rooms with textureless walls. Whether COLMAP registers those at all is the open risk D-009 named, and only real frames can close it.
