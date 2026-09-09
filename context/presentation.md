---
focus: Built and published — https://claude.ai/code/artifact/310cd4ee-8355-4ff1-8a2f-d573f145f703 · awaiting the human's review
next:
  - Human review of the published deck
  - Swap the embedded model for a JetBot capture once the robot has produced one (§ Assets)
  - Rebuild the embedded viewer through the aligned pipeline — the Dr Johnson model in it hangs 14.3° off level, measured from its poses; republishing the artifact is a human call
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

**Light is the default in both modes, on any host theme.** An earlier build tied the palette to the mode and forced deck mode dark, which silently replaced the direction that had been chosen. The mode now decides layout only. Dark is a real toggle (`t`, remembered per browser) for a hall where a pale ground washes out — the human's call at the podium, not a build-time one.

**Keep the blooms behind the type, never around it.** That is the line between this direction and decoration.

## Interaction — these six, nothing else

Deck/doc toggle · a light/dark toggle, light by default · the embedded room viewer (section 14 only, built on an explicit click) · a scrubber over the real PSNR curve · pipeline stages that reveal their measured time and failure mode · status branches that expand into per-package state · the algorithm cards including the empty `?`.

Anything beyond this is decoration a projector cannot use.

## Assets

**Own material first.** COLMAP point cloud, Brush training window and the finished viewer all exist in `repos/pipeline-3d/runs/`. Screenshots of our own runs are stronger than borrowed ones and carry no licence question. Foreign material is needed only for `jetson-inference`; the JetBot itself can be photographed.

**Foreign material carries a licence line** — project · licence · link — on the same card. Brush Apache-2.0, COLMAP BSD, SuperSplat / jetson-inference / JetBot MIT all permit redistribution with attribution.

**Everything embeds as a data URI.** The Artifact CSP blocks external images outright, and the whole page must stay under 16 MB.

**The room model, measured 2026-09-09.** A pipeline `model.html` is ~12 MB — three quarters of the budget. Recipe that fits, run against the source `.sog`:

```
splat-transform <run>/filtered.sog -H 0 -F -d 40% x.ply   # ~10 s
splat-transform x.ply presentation/assets/room.html       # 159 k splats, 5.5 MB
```

**Dropping spherical harmonics beats decimating.** `-H 0` yields 60 % *more* splats in a smaller file than `-d 25%` alone (159 k / 5.5 MB against 99 k / 6.4 MB): SH encodes view-dependent highlights, which an orbit through a room barely spends. Verified rendering in a browser. The viewer's only external reference is jsDelivr for WebXR controller profiles — allowlisted, and untouched without VR. Its own export button is inert inside an artifact, which grants pages no download permission.

## Status semantics

Three states, one legend, no fourth: **green** built and measured · **amber** written, never run on hardware · **grey** open. Counts at 2026-09-09 — pipeline-3d 5/6, robot 0/5, driving 1/6 — and the blocker named in plain words.

This is not a presentational choice. VISION.md's *functional instead of facade* forbids showing what does not run, and "we built the half that could be built without the hardware, and measured it instead of guessing" is the stronger claim in front of a class anyway.

Section 13 falls under the same rule: automatic deploy is postponed (state/profile.md), so it appears as vision and says so. The ~9 Mbit/s ceiling constrains the *download* by a full lecture hall, not the 6.7 MB upload.

## Build

`presentation/deck.template.html` holds the page; `presentation/assets/` holds what travels inside it; `python3 presentation/build.py` injects the assets and writes `presentation/deck.html`, which is what gets published. Edit the template, never `deck.html`.

The viewer goes into a `<script type="text/plain">` block with `</script` swapped for a sentinel the page restores at runtime — unlike base64 that costs no size. `build.py` refuses to write if a placeholder is unfilled or the page passes 16 MB. Its placeholder scan reads the template, never the output: the viewer bundle carries its own `__PURE__` annotations.

**The dataset is the public Deep Blending `drjohnson` capture, chosen 2026-09-09.** The `room-niklas` run reconstructs a private bedroom, and the deck is projected to a class and shared as a link. Do not swap it back; the replacement to want is the JetBot's own first capture.

## Prose

Both slop skills are installed and were applied to every visible string on 2026-09-09: `stop-slop` (`.claude/skills/stop-slop/`, its three `references/` fetched from upstream, TF-003) and `no-ai-slop` (`.claude/skills/no-ai-slop/`, imported direct, scanned first — see `.claude/SOURCES.md`). 45 edits. The visible copy carries **no em dashes**; the remaining ones are in code comments. Keep it that way when editing the template.

## Not this

No video: the robot has never been on the network, so any footage of it would be staged — the one thing VISION.md rules out. The training progression is animated from the measured PSNR curve instead. No second artifact and no slide framework — the only build step is one Python file that inlines the assets.
