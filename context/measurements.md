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
| `sh1` | `--sh-degree 1` | 1575 s | **+62 %** | 24.85 | 1.28 M | 19.0 MiB | 1.20 GiB |
| `fast` | 5000 steps, 800 px, 400 k cap, SH 2 | **289 s** | **−70 %** | 24.37 ¹ | 400 k | **6.8 MiB** | 0.93 GiB |

¹ Measured against downscaled eval images. PSNR is **not comparable across different `--max-resolution` values** — a smaller target is easier to fit. Only `cap400k` and `sh1` can be read against `base` directly.

What this says:

- **Steps are the only lever with a near-linear effect.** Everything else is sublinear: a 3.2× splat cut buys 24 % time, a 2.3× pixel cut buys 16 %.
- **Splat count governs delivery size, not runtime.** `cap400k` is 2.4× smaller on disk for 24 % less time — and lands under the one-million-splat ceiling PlayCanvas names for mobile devices, which the baseline exceeds.
- **`--sh-degree 1` is a trap.** 62 % *slower* at identical splat count and resolution, for 0.26 dB. Memory drops as expected, so the parameters really are smaller; the runtime is anomalous. Leading explanation is the shape-keyed autotune cache, cold for the 4-coefficient layout while the run was being timed. Untested — the repeat run was cancelled.
- **Combined, `fast` gives 3.4× the speed and a third of the delivery size** for roughly 0.7 dB. Do not reach for SH degree below 2 to get there.

## Measurement protocol

Long runs under uncontrolled conditions produced two false conclusions in one session — first from background load and a cold cache, then from a laptop that spent part of the series inside a cotton bag. Future measurements follow this instead.

**Physical setup, fixed and stated.** Open, on a hard surface, in room air, never on fabric or in a bag. Power connected. No lid closing, no moving the machine mid-series. If the setup changes, the series is over.

**Software setup.** Quit background applications. Read `sysctl -n vm.loadavg` before starting and abort if the 1-minute figure is above ~2. Log the load average at start and end of every run — the runner already does.

**Short runs, not long ones.** Measure at **2000 steps**, not 8000. The 8000-step curve above is the reference that makes this legitimate: the ordering of configurations and the per-step cost are both established well before step 2000, and a 2000-step run costs about two minutes instead of sixteen. Extrapolate to full length through the curve, do not re-measure it.

**Warm the cache per configuration.** Before timing a configuration that changes a tensor shape (`--sh-degree`, `--max-resolution`), run it once for 200 steps and throw the result away. Otherwise the kernel search lands inside the measurement — that is what `sh1` most likely shows.

**Sandwich every comparison.** Run A, then B, then A again, in one sitting. If the two A runs differ by more than 3 %, discard the whole session rather than explaining the difference. This catches thermal drift, background load and cache effects at once, without needing to identify which one occurred.

**Separate what temperature can touch from what it cannot.** PSNR, SSIM, splat counts and file sizes are deterministic at a fixed seed and survive any thermal condition — the `base`/`base2` pair agrees to 0.03 dB. Only durations need this protocol.

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

## Open

- **The SfM half is unmeasured.** Every number here starts from poses shipped with the dataset. For the JetBot that step is real work and probably the larger block — `colmap mapper` against `colmap global_mapper` is Package 3.
- **`sh1`'s slowness has no confirmed mechanism.** A repeat with a warm cache would settle it in about two minutes under the protocol above.
