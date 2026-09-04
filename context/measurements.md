# Measurements

> Belongs here: measured runtimes and sizes on real hardware, with measurement conditions. Not here: tool choice rationales (state/decisions/), planning (context/plan-*.md).

Numbers taken from the research phase are replaced by measured ones here. What is written here has been verified; what is in a decision and missing here, is not.

## Method

Machine: MacBook Air M4, 10 CPU cores, 24 GB, **fanless**, macOS 27. Brush `brush-cli 1.0.0` built from source at commit `8b7f5c6` (release, thin LTO). Dataset `tandt/truck` (Tanks & Temples): 251 images at 979×546, COLMAP poses shipped with the dataset, so no SfM step is involved in these numbers.

Two things had to be fixed before the numbers meant anything:

- **Brush prints nothing without a terminal.** The progress UI is `indicatif`, which silently disables itself when stdout is not a TTY, and no pty is available in this environment. Runs therefore log via `RUST_LOG=info`, which yields per-eval PSNR/SSIM, per-refine splat counts and timestamps.
- **The autotune cache is warm after the first run.** CubeCL stores kernel-variant choices in `~/.cache/cubecl`. The very first run on this machine paid for building it. Every number below is from a warm cache and describes a *repeat* run.

Command shape:

    RUST_LOG=info /usr/bin/time -l brush <dataset> \
      --total-train-iters 8000 --export-every 8000 --eval-split-every 8

## Reference run Brush — 2026-09-04, quiet machine

| Quantity | Value |
|---|---|
| Build of Brush from source | 13 min 58 s |
| **Training, 8000 steps** | **974 s — 16 min 14 s** |
| Total incl. dataset load and export | 991 s — 16 min 32 s |
| Peak resident set size | 2.13 GiB |
| Splats in result | 1,279,868 |
| Export `.ply` (SH degree 3) | 288 MiB |
| Conversion to `.sog` | 59 s |
| Result `.sog` | **19.1 MiB — factor 15.1** |

CPU time was 64 s user plus 40 s system against 974 s wall clock: the work runs on the GPU via Metal, the CPU only feeds it.

### Quality over training steps

Eval split: every 8th image held out, 32 eval views against 219 training views.

| Steps | PSNR | SSIM | Splats | Cumulative time |
|---:|---:|---:|---:|---:|
| 1000 | 21.52 | 0.774 | 255 k | 0:50 |
| 2000 | 23.04 | 0.827 | 452 k | 1:56 |
| 3000 | 23.94 | 0.855 | 666 k | 3:38 |
| 4000 | 24.32 | 0.866 | 856 k | 5:50 |
| 5000 | 24.65 | 0.873 | 976 k | 8:23 |
| 6000 | 24.79 | 0.878 | 1.10 M | 11:21 |
| 7000 | 24.95 | 0.881 | 1.22 M | 14:35 |
| 8000 | **25.11** | 0.885 | 1.28 M | 16:14 |

**The second half of the run costs half the time and buys 0.46 dB.** Step 4000 reaches 97 % of the final PSNR in 36 % of the time. This is the measured answer to D-002's unverified "~92 % of full quality" claim — the shape of the curve is right, the cheap steps are the early ones.

Cost per 1000 steps rises from 50 s to 194 s, tracking the splat count. It never levels off because `growth_stop_iter` is clamped to `total_train_iters` (`crates/brush-train/src/train.rs:150`): at 8000 steps the model grows until the last iteration and never gets a consolidation phase.

### Throttling

Normalised to splat count, time per step per splat stays at roughly 0.17 µs across the whole 16-minute run and drops in the final segment. **A single run of this length does not throttle measurably.** This replaces the earlier open gap — `pmset -g therm` returns no `CPU_Speed_Limit` on Apple Silicon, so throughput normalisation was used instead of a thermal sampler.

latent: This holds for *one* run from a cool machine. Back-to-back runs are a different question and are being measured separately — see the open item below.

## What this corrects in the decisions

| Claim | Origin | Finding |
|---|---|---|
| "~6 min for 8000 steps" | D-002 | **false** — 16 min 14 s on a quiet machine |
| "~92 % of full quality" | D-002 | **measured** — 97 % of final PSNR at step 4000, 98 % at 5000 |
| Switch `--total-steps` | D-002 | **false** — is called `--total-train-iters` |
| Manual downsampling needed | D-002 | **obsolete** — Brush downscales itself (`--max-resolution`, default 1920) |
| `.sog` 15–20× smaller than `.ply` | D-004 | **confirmed** — factor 15.1, twice |
| Conversion "~15 sec" | D-004 | **false** — 59 s |
| `npx splat-transform` | D-004 | **false** — package is `@playcanvas/splat-transform` |

## Earlier run, for comparison only — 2026-09-04, 19:01

Same flags, but cold autotune cache and a concurrent multi-agent run in the same working tree: training 20 min 07 s, conversion 1 min 07 s, `.sog` 19.1 MiB. The 19 % difference is background load plus cache build, not a change in the software. Peak memory was reported as 3.9 GB there and 2.13 GiB here; these are **different fields** of `/usr/bin/time -l` (`peak memory footprint` vs `maximum resident set size`) and are not comparable.

## Open

- **The variant comparison is not yet trustworthy.** Four runs isolating one lever each (`--max-resolution 640`, `--max-splats 400000`, `--sh-degree 1`, and a combined preset) were run back-to-back. Two results are physically implausible — `--sh-degree 1` came out 60 % *slower* than the baseline at identical splat count and resolution, and `--max-splats 400000` cost more per step at 400 k splats than the baseline did at 350 k. Both point at accumulated heat on a fanless machine rather than at the flags. A control run with baseline flags after an hour of continuous load decides whether the series is usable or has to be repeated with cooldown gaps.
- **The SfM half is unmeasured.** These numbers start from poses that ship with the dataset. For the JetBot the pose step is real work and probably the larger block.
