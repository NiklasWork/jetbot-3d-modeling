---
focus: Reordered and retrimmed 2026-09-10 — same 11 sections in a new order (§ Sections), the opening cloud is now the trained model in a small corner box, and the camera-angle slide is corrected against the first frames off the robot. Published 2026-09-10 at 8.69 MB: **https://claude.ai/code/artifact/dd31426b-66b2-418a-a005-e92e76306c6c**
next:
  - A photograph of the JetBot, the one image nobody but us can produce (§ Assets)
  - Swap the embedded model for a JetBot capture once the robot has produced one (§ Assets)
blockers: none
---

# Presentation

> Belongs here: the plan for the university presentation artifact — scope, sections, assets, build order. Not here: the content itself (it is quoted from VISION.md, context/architecture.md, context/measurements.md and the three plan files — link, never copy), and the artifact is deliberately **not** canonical state.

## The deliverable

**One HTML file, two modes.** A key toggles between *deck* (arrow keys, one full-viewport section, projector-sized type) and *doc* (the same sections unrolled and scrollable, for sharing after the talk). One content tree, two presentations — a second artifact would drift from the first.

English. Published as an Artifact: https://claude.ai/code/artifact/dd31426b-66b2-418a-a005-e92e76306c6c

**The URL changed on 2026-09-10 and the old one is gone.** Every earlier note here pointed at `310cd4ee-8355-4ff1-8a2f-d573f145f703`; that artifact no longer resolves and does not appear in the human's own artifact list, so it was deleted or never belonged to this account. There is no way to publish back onto a URL that does not exist. Anyone holding the old link has a dead one. Republishing from this repo keeps the new URL as long as it goes out as `presentation/deck.html` from a session that has read or published it.

**This is an idea being presented, not a deliverable being defended.** Settled 2026-09-09: no grade, no time budget, no external requirement list. Everything in it is therefore changeable, and "the brief asked for it" is never a reason to keep something.

Combines three things at once: the idea pitch, the developer-facing architecture, and the roadmap with its real status.

## The one structural rule

**Left is the robot, right is the Mac, on every slide that has two sides.** The idea, the two meanings of "model", the architecture lanes, the numbers, the open-source rail: all of them read client on the left, server on the right. A slide that breaks it costs the audience the one piece of orientation the deck hands them for free.

## Sections

Rebuilt 2026-09-09 from 14 to 11 on the human's review. The three that went: *How the work is split* (the left-right rule carries it now, and its two surviving facts are footnotes under the architecture), *What happens next* and *Vision* — both cut outright, so automatic deploy is gone from the deck entirely rather than relocated.

| # | Section | Source |
|---|---|---|
| 1 | What this is, in plain words, and four numbers whose labels explain them | VISION.md |
| 2 | The idea as two lanes: cover and photograph · turn photos into a model | VISION.md, D-013 |
| 3 | "Model" means two things: the driving model (left, open) · the 3D model (right, built) | APPLICATION-VISION.md |
| 4 | Architecture as a two-lane activity diagram, with the capture loop and the registration gate | context/architecture.md |
| 5 | Open source placed on the workflow, each project expanding into role, licence and a picture | state/profile.md |
| 6 | What one run costs: a stage bar whose widths are the measured seconds | context/measurements.md |
| 7 | Three ways to drive: a fixed script · a trained model · an open slot | D-014, context/plan-driving.md |
| 8 | The one rule any of the three has to satisfy: sideways motion | context/plan-driving.md |
| 9 | The open problem: the camera is fixed and points down | context/plan-robot.md package 2 |
| 10 | Status board | the three plan files |
| 11 | The example model, live in the browser | § Assets |

**Reordered 2026-09-10, two moves, on the human's choice between a minimal and a bolder option.** Open source moved above the cost slide, so that the architecture diagram is drawn (4), then labelled with who does each step (5), then timed (6) — three slides on one picture in increasing detail, instead of the cost slide interrupting. And the camera-angle slide moved up beside the sideways-motion rule (8, 9), because both say what the hardware physically permits during a capture; the status board had been wedged between them. The status board is now the summary immediately before the model, which is where a summary belongs.

The rejected option moved the live model from 11 to 3, to show the result before explaining it. Declined: slide 1 already turns the model behind the headline, so the first impression is spent either way, and "here is where we stand and what the group does next" is the stronger close for a group talk than a model the room has already seen.

**Section 7 carries the weight.** It is the part the group works on next, so the trained-model option names its requirements in full — labelled frames, ResNet-18 trained on the device, camera-only input, the beat-the-mean bar, exclusive time on shared hardware — instead of standing as one line beside the others. Section 8 exists only to give those three options a shared measuring stick, which is why it was cut from a full slide down to one figure and one paragraph.

**One slide, one run.** Caught by an audit on 2026-09-09, after the rebuild introduced it: the cost slide's stage bar carries the 380 s end-to-end run (99 / 254 / 27 s, `fast` preset on 251 photos) while two of its detail panels quoted the 8000-step reference run on the same photos (974 s on the clock, 288 MB → 19 MB at 15.1×). Every figure traced to context/measurements.md, and together they were nonsense: 974 s cannot describe a 254 s stage, and the compression that actually ran there is 58 MB → 6.8 MB, a factor of 8.5. The details now come from the run the bar's widths are drawn from, and the one figure still borrowed from the longer run says so on the slide. **A figure is only measured if it comes from the same run as the figure beside it.**

**Every number on a slide states what it is a number of.** Settled 2026-09-09 after a bare `380 s` and a bare `15.1×` reached the human and meant nothing to him. A figure carries a label a stranger can read, or it comes off the slide.

## Visual direction — Emergence

Chosen 2026-09-09 from three specimens, all three kept in `presentation/directions.html` and published at https://claude.ai/code/artifact/2f41c40a-a929-4c76-aab4-2f9309812236 so a later pass can compare against the rejected ones rather than re-deriving them.

Emergence borrows the look of the thing being built: soft translucent blooms resolving into form, so the page reads like the artifact it describes. Fraunces 600 as display, Karla as body. `#F4F4F7` ground · `#1D1C2A` ink · `#5B4BD6` accent · `#D64B92` secondary bloom.

**Light is the default in both modes, on any host theme.** An earlier build tied the palette to the mode and forced deck mode dark, which silently replaced the direction that had been chosen. The mode now decides layout only. Dark is a real toggle (`t`, remembered per browser) for a hall where a pale ground washes out — the human's call at the podium, not a build-time one.

**Keep the blooms behind the type, never around it.** That is the line between this direction and decoration.

## Interaction — these six, nothing else

Deck/doc toggle · a light/dark toggle, light by default · pipeline stages that reveal their measured time and failure mode · open-source projects that expand into role, licence and a picture · status branches that fold away · the embedded room viewer, section 11 only, built on an explicit click.

**The PSNR scrubber is gone** (2026-09-09). It asked the audience to understand decibels before it paid anything back. The same curve is now a static figure with plain-language axes and one claim written on it, which is what the interaction existed to produce.

**The status board arrives open.** Three collapsed bars read as an empty slide, and the detail is the point of it. Clicking folds a branch away rather than opening it.

Anything beyond this list is decoration a projector cannot use.

## Assets

**Own material first.** Screenshots of our own runs are stronger than borrowed ones and carry no licence question. Foreign material appears exactly once, for `jetson-inference`, credited on the same card.

**The JetBot still has no photograph**, and it is the one image nobody outside this project can produce. The JetBot card on the open-source slide and the sketch on the camera-angle slide would both take one.

**No still of our own finished model, and this was tried.** Four camera positions in the viewer on 2026-09-09, every one of them fog: `context/measurements.md` already records that indoor runs come out hazy and that the viewer's opening camera sits inside the haze. A person can move past it in the live viewer on section 11, which is the honest way to show this model. A still would sell it under value.

**The opening image is the trained model, not the sparse cloud** (changed 2026-09-10). The sparse cloud was there first and could not be made to read as a room, because it is not one — a few tens of thousands of separately triangulated feature points do not become a room by being drawn denser or brighter. It still draws the COLMAP card on the open-source slide, where the claim is COLMAP's own output. **It draws the whole model** (2026-09-10): 398 618 of the 400 000 gaussians, the missing 1 382 being strays that sit metres outside the room and would otherwise shrink everything else to a dot. Packed as base64 int16 plus RGBA rather than JSON numbers, 10 bytes a splat against about 30, so the page holds all of it at 11.60 MB.

**Drawing all of them only works because size scales opacity.** The first attempt at the unfiltered model was worse than the filtered one, and predictably so: the canvas paints every gaussian as a small solid dot, so a large faint one, which in the model describes a region rather than a surface, arrives as a hard mark in the middle of nothing. Four hundred thousand of those is dust over the whole room. The fix is not a filter but a weight — at or below the 80th size percentile a splat keeps its own opacity, above it the weight falls with the square of how much wider it is, which is how its energy really spreads. Surfaces then look as they did under the old hard cut while the haze is present and faint instead of absent. `SIZE_REF_PERCENTILE` in `presentation/pointcloud.py`.

**The binding limit is frame time, not bytes** — 19.5 ms per frame measured at projector size, about 51 fps against a 60 fps budget, and knowingly over it: the rotation is driven by elapsed time rather than by frames, so a slow machine turns the room at the same speed and draws fewer frames. `KEEP_DENSE` is the one constant to lower if a podium ever stutters.

**The cloud is a small box in the right-hand corner, and the type is capped to clear it** (2026-09-10). It briefly spanned 58 % of the slide, which reads as decoration rather than an object; small, it is also denser per screen area, which is the only variable legibility here depends on. Every width on that slide is measured in the page rather than guessed: the headline's three natural lines run 785, 746 and 1037 px against an .inner of 1110, so the third alone wants 93 % of the width and the four-line break is forced, not styled. Lead 62 %, figures 52 %, headline 78 % as a fallback for a missing Fraunces.

**The sparse point cloud, for the open-source slide.** COLMAP recovered **81 051** points in this run, read straight out of `runs/drjohnson/undistorted/sparse/points3D.bin`. context/measurements.md's benchmark table records 81 175 for the same dataset from a standalone invocation, 0.15 % apart; nobody has chased the difference and the deck quotes the file it actually draws. the deck draws 24 000 of them, rotating, to the right of the headline. Two corrections on 2026-09-09: an earlier build drew 6 000 and captioned them `31 086`, a number with no source anywhere in the repo; and the cloud carried the same 14.3° lean as the viewer. `presentation/pointcloud.py` now writes it, gravity rotation included, from the same `gravity.mjs` the viewer recipe uses.

**Foreign material carries a licence line** — project · licence · link — on the same card. Brush Apache-2.0, COLMAP BSD, SuperSplat / jetson-inference / JetBot MIT all permit redistribution with attribution.

**Everything embeds as a data URI.** The Artifact CSP blocks external images outright, and the whole page must stay under 16 MB. Current build: 6.53 MB.

**The room model, measured 2026-09-09.** A pipeline `model.html` is ~12 MB — three quarters of the budget. Recipe that fits, run against the source `.sog`:

```
splat-transform <run>/filtered.sog -r $(node repos/pipeline-3d/gravity.mjs <run>/undistorted/sparse/images.bin) \
                -H 0 -F -d 40% x.ply                      # ~10 s
splat-transform x.ply presentation/assets/room.html       # 159 k splats, 5.5 MB
```

**The `-r` is not optional.** `room.html` and `deck.html` are gitignored build outputs, so the only place the alignment survives is this recipe: drop the rotation and the next rebuild silently puts the room back on its 14.3° lean, which the viewer cannot steer out of (repos/pipeline-3d/README.md § compress).

**Dropping spherical harmonics beats decimating.** `-H 0` yields 60 % *more* splats in a smaller file than `-d 25%` alone (159 k / 5.5 MB against 99 k / 6.4 MB): SH encodes view-dependent highlights, which an orbit through a room barely spends. Verified rendering in a browser. The viewer's only external reference is jsDelivr for WebXR controller profiles — allowlisted, and untouched without VR. Its own export button is inert inside an artifact, which grants pages no download permission.

## Status semantics

Three states, one legend, no fourth: **green** built and tested · **amber** written, never run on the robot · **grey** open. Counts at 2026-09-09 — pipeline-3d 5/6, robot **1/5**, driving 0/2.

**The robot's first package went green on 2026-09-09**: boot, WiFi, Jupyter and `basic_motion` driving the wheels are accepted by the human (state/current.md, context/plan-robot.md). Two legend contradictions went with it: the transfer script showed grey while its own text called it written-and-unrun, which the legend calls amber, and the capture script did the same.

**The driving branch is deliberately two lines, not six.** Nothing there is decided, so the deck shows the fixed script (amber) and a trained model (open) and stops. The six planning packages stay in context/plan-driving.md where they belong.

This is not a presentational choice. VISION.md's *functional instead of facade* forbids showing what does not run, and "we built the half that could be built without the hardware, and measured it instead of guessing" is the stronger claim in front of a class anyway.

## Build

`presentation/deck.template.html` holds the page; `presentation/assets/` holds what travels inside it; `python3 presentation/build.py` injects the assets and writes `presentation/deck.html`, which is what gets published. Edit the template, never `deck.html`.

The viewer goes into a `<script type="text/plain">` block with `</script` swapped for a sentinel the page restores at runtime — unlike base64 that costs no size. `build.py` refuses to write if a placeholder is unfilled or the page passes 16 MB. Its placeholder scan reads the template, never the output: the viewer bundle carries its own `__PURE__` annotations.

**Two canvas traps, both hit and both fixed 2026-09-09.** A canvas painted only from `requestAnimationFrame` stays blank when the deck opens in a background tab, so the opening cloud draws its first frame synchronously and starts the loop after it. And a canvas created by an `innerHTML` swap has no box on the tick that creates it: drawing straight away sized it 2×2 and the browser stretched four pixels across the whole card, which looks like a styling bug and is not one. The open-source card waits for a layout on a timer, not a frame callback, for the same background-tab reason.

**The dataset is the public Deep Blending `drjohnson` capture, chosen 2026-09-09.** The `room-niklas` run reconstructs a private bedroom, and the deck is projected to a class and shared as a link. Do not swap it back; the replacement to want is the JetBot's own first capture.

## Prose

Both slop skills are installed and were applied to every visible string on 2026-09-09: `stop-slop` (`.claude/skills/stop-slop/`, its three `references/` fetched from upstream, TF-003) and `no-ai-slop` (`.claude/skills/no-ai-slop/`, imported direct, scanned first — see `.claude/SOURCES.md`). The visible copy carries **no em dashes** and none of the banned vocabulary, re-checked after the 2026-09-09 rebuild replaced most of it; the remaining dashes are in code comments. Keep it that way when editing the template.

## Not this

No video: the robot has never driven a capture, so any footage of it would be staged — the one thing VISION.md rules out. No second artifact and no slide framework — the build is two Python files, one that writes the point cloud and one that inlines the assets.
