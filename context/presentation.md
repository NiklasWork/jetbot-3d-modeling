---
focus: One HTML artifact that pitches the idea, explains the architecture and shows the honest status — for a 10–15 min university talk and as a link afterwards
next:
  - Produce the assets, own ones first (§ Assets)
  - Build the artifact in the order under § Build
blockers: none
---

# Presentation

> Belongs here: the plan for the university presentation artifact — scope, sections, assets, build order. Not here: the content itself (it is quoted from VISION.md, context/architecture.md, context/measurements.md and the three plan files — link, never copy), and the artifact is deliberately **not** canonical state.

## The deliverable

**One HTML file, two modes.** A key toggles between *deck* (arrow keys, one full-viewport section, projector-sized type) and *doc* (the same sections unrolled and scrollable, for sharing after the talk). One content tree, two presentations — a second artifact would drift from the first.

English. 10–15 minutes, roughly a minute per section. Published as an Artifact.

Combines three things a university audience needs at once: the idea pitch, the developer-facing architecture, and the roadmap with its real status.

## Sections

| # | Section | Source |
|---|---|---|
| 1 | Thesis — a room appears on the screen beside the robot | APPLICATION-VISION.md |
| 2 | The idea in one screen | VISION.md |
| 3 | "Model" means two different things here | APPLICATION-VISION.md |
| 4 | Architecture: JetBot · Mac · Lenovo, boundary is latency | context/architecture.md |
| 5 | The pipeline and its single point of failure | APPLICATION-VISION.md |
| 6 | The numbers: capture side and compute side | context/measurements.md |
| 7 | Open source we stand on — role, licence, preview | state/profile.md |
| 8 | Two branches, one deliberately dumb interface | D-011 |
| 9 | Capture manoeuvres, and why parallax decides | context/plan-driving.md |
| 10 | Driving algorithm: approaches, including an open slot | D-014, context/plan-driving.md |
| 11 | Status board | the three plan files |
| 12 | Roadmap and the one physical blocker | state/current.md |
| 13 | Vision: a run deploys itself — **marked as vision, not built** | D-007 |
| 14 | Live: the room, in the browser | § Assets |

## Visual direction — Emergence

Chosen 2026-09-09 from three specimens, all three kept in `presentation/directions.html` and published at https://claude.ai/code/artifact/2f41c40a-a929-4c76-aab4-2f9309812236 so a later pass can compare against the rejected ones rather than re-deriving them.

Emergence borrows the look of the thing being built: soft translucent blooms resolving into form, so the page reads like the artifact it describes. Fraunces 600 as display, Karla as body. `#F4F4F7` ground · `#1D1C2A` ink · `#5B4BD6` accent · `#D64B92` secondary bloom.

**Its one weakness, and the fix.** A light ground is the weakest of the three under lecture-hall lighting. Deck mode therefore takes a deep-indigo counterpart of the same palette — same faces, same blooms, inverted ground — while doc mode keeps the light one. The two modes already exist for other reasons, so this costs a token set, not a second design.

**Keep the blooms behind the type, never around it.** That is the line between this direction and decoration.

## Interaction — these six, nothing else

Deck/doc toggle · the embedded room viewer (section 14 only, loads on arrival) · a scrubber over the real PSNR curve · pipeline stages that reveal their measured time and failure mode · status branches that expand into per-package state · the algorithm cards including the empty `?`.

Anything beyond this is decoration a projector cannot use.

## Assets

**Own material first.** COLMAP point cloud, Brush training window and the finished viewer all exist in `repos/pipeline-3d/runs/`. Screenshots of our own runs are stronger than borrowed ones and carry no licence question. Foreign material is needed only for `jetson-inference`; the JetBot itself can be photographed.

**Foreign material carries a licence line** — project · licence · link — on the same card. Brush Apache-2.0, COLMAP BSD, SuperSplat / jetson-inference / JetBot MIT all permit redistribution with attribution.

**Everything embeds as a data URI.** The Artifact CSP blocks external images outright, and the whole page must stay under 16 MB.

**The room model, measured 2026-09-09.** `runs/room-niklas/model.html` is 11.8 MB — three quarters of the budget. Recipe that fits:

```
splat-transform model.sog -H 0 -F -d 40% room.ply     # 12 s
splat-transform room.ply room.html                    # 158 k splats, 5.5 MB
```

**Dropping spherical harmonics beats decimating.** `-H 0` yields 60 % *more* splats in a smaller file than `-d 25%` alone (158 k / 5.5 MB against 99 k / 6.4 MB): SH encodes view-dependent highlights, which an orbit through a room barely spends. Verified rendering in a browser. The viewer's only external reference is jsDelivr for WebXR controller profiles — allowlisted, and untouched without VR.

## Status semantics

Three states, one legend, no fourth: **green** built and measured · **amber** written, never run on hardware · **grey** open. Counts at 2026-09-09 — pipeline-3d 5/6, robot 0/5, driving 1/6 — and the blocker named in plain words.

This is not a presentational choice. VISION.md's *functional instead of facade* forbids showing what does not run, and "we built the half that could be built without the hardware, and measured it instead of guessing" is the stronger claim in front of a class anyway.

Section 13 falls under the same rule: automatic deploy is postponed (state/profile.md), so it appears as vision and says so. The ~9 Mbit/s ceiling constrains the *download* by a full lecture hall, not the 6.7 MB upload.

## Build

Assets → content as one JS data object → shell with the deck/doc mechanism → sections → architecture diagram as inline SVG → prose through the `stop-slop` skill → publish.

## Not this

No video: the robot has never been on the network, so any footage of it would be staged — the one thing VISION.md rules out. The training progression is animated from the measured PSNR curve instead. No second artifact, no slide framework, no build step.
