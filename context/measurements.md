# Measurements

> Belongs here: measured runtimes and sizes on real hardware, with measurement conditions. Not here: tool choice rationales (state/decisions/), planning (context/plan-*.md).

Numbers taken from the research phase are replaced by measured ones here. What is written here has been verified; what is in a decision and missing here, is not.

## Reference run Brush — 2026-09-04

Condition: MacBook Air M4, 24 GB, fanless, macOS 27. Brush from source as of 2026-09-04, release build. Dataset `tandt/truck` (Tanks & Temples), 251 images at 979×546, COLMAP poses provided. No viewer, with `--eval-split-every 8`.

| Size | Value |
|---|---|
| Build of Brush from source | 13 min 58 s |
| Training, 8000 steps | **20 min 07 s** |
| Peak memory | 3.9 GB |
| Splats in result | 1,284,760 |
| Export `.ply` (SH degree 3) | 289 MB |
| Conversion to `.sog` | 1 min 07 s |
| Result `.sog` | **19.1 MB — factor 15.1** |

CPU time was only 85 s user plus 58 s system time against 1207 s wall clock: the work ran as expected on the GPU via Metal, not on the CPU.

## What this corrects in the decisions

| Claim | Origin | Finding |
|---|---|---|
| "~6 min for 8000 Steps" | D-002 | **false** — 20 min, off by a factor of 3.3 |
| "~92 % of full quality" | D-002 | **unverified** — no comparison run over 30k steps done |
| Switch `--total-steps` | D-002 | **false** — is called `--total-train-iters` |
| Manual downsampling needed | D-002 | **obsolete** — Brush downscales itself (`--max-resolution`, default 1920) |
| `.sog` 15–20× smaller than `.ply` | D-004 | **confirmed** — factor 15.1 |
| Conversion "~15 sec" | D-004 | **false** — 1 min 07 s |
| `npx splat-transform` | D-004 | **false** — package is called `@playcanvas/splat-transform` |

## Open measurement gap

latent: Throttling is not measured. `pmset -g therm` returns no `CPU_Speed_Limit` line on Apple Silicon, the sampler wrote empty values. A real thermal statement requires `sudo powermetrics --samplers smc` or a longer run with throughput comparison at the beginning and at the end. Relevant as soon as a run goes significantly over 20 min.
