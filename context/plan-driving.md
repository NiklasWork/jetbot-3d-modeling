---
focus: The robot drives the capture manoeuvre itself while the human picks where
next:
  - Package 1 — Manoeuvre library in capture.py
  - Package 2 — Step size against the undistorted field of view
  - Package 3 — A whole room by manoeuvres, measured against a hand-driven one
blockers: gated on OD-003 and on plan-robot package 5 — see "Relation to decisions"
---

# Plan driving algorithm

> Belongs here: the expansion in which the robot performs the capture motion itself. Not here: the path to the first prototype (context/plan-robot.md), hardware facts (context/architecture.md), the undecided question itself (state/open-decisions.md, OD-003).

**Expansion reached when:** a drive in which the human only picks standpoints, and the robot performs every capture manoeuvre, yields a model at least as good as a hand-driven drive of the same room.

Nothing here has been verified against hardware. `capture.py` itself has never run (repos/robot/README.md), and whether COLMAP registers this camera's frames at all is still open (context/measurements.md).

## Why the plan optimises motion, not navigation

A driving algorithm that only avoids obstacles produces bad 3DGS data, and the reason is sharper than "too little overlap". Two classical degeneracies sit on exactly the two motions such an algorithm generates:

- **Rotation on the spot gives no parallax.** Overlap is plentiful, triangulation impossible. The JetBot escapes this only slightly — its camera sits ahead of the wheel axis, so a spin traces a small circle rather than turning about the lens. That offset has never been measured; estimating it at 5–10 cm against 2–5 m of room depth puts the baseline-to-depth ratio somewhere in 1–5 % where 5–15 % is wanted, so only the most favourable corner of that range is even marginal. Measure the offset before relying on any of it.
- **Driving straight at what you are photographing gives no parallax either.** The expansion point sits at the image centre, where displacement is zero. This is a statement about the boresight, not the whole frame: under forward motion a 160° fisheye still gets real parallax at the periphery, which is why wide lenses tolerate forward motion better than narrow ones. What it rules out is approaching the surface you are trying to reconstruct.

What does work is **lateral motion relative to the surface being captured** — passing a wall rather than approaching it. The 160° fisheye is the asset that makes this practical: it sees sideways. The best indoor capture path is therefore a closed loop parallel to the walls at constant distance, driven twice at different distances from the wall so the same surface is seen from two depths, not an exploration. Package 3 is where that claim gets tested.

`capture.py` already encodes half of this: `a`/`d` drive an arc rather than a spin, for this reason.

**What the hardware cannot do, at all:** know where it is. No wheel encoders, no IMU, no map (D-012). Coverage and loop closure are therefore human tasks in every package below, and no amount of perception changes that.

## Packages

Each is individually acceptable. Everything runs on Python 3.6 (D-008); nothing here adds a library.

1. **Manoeuvre library.** One key runs a *sequence* of the single steps `capture.py` already has, with a shot after each: **orbit** (N× arc), **wall pass** (N× forward), **panorama** (N× spin). The two seams it needs exist — the `_motion_for()` key table and the `shoot()` closure — but the per-step sequence around them (drive, settle, shoot, min-change check, write, bump the index, print) is inlined in `main()`'s keyboard loop, so it has to be lifted into one callable step first, with abort polling threaded through it. Pick the manoeuvre keys explicitly and check them against the bindings `capture.py` already documents. Panorama is connective tissue for the matcher, never the depth source — say so at the key. Safety is part of this package, not a later one: any keypress aborts mid-run, and the `--min-change` gate that today skips one frame must end the whole manoeuvre, since identical consecutive frames are what a robot pushing against furniture produces.
   *Done when:* one keypress drives a full manoeuvre and writes its frames; any key aborts it mid-run with the wheels stopped; and a manoeuvre driven into an obstacle ends by itself within two frames.

2. **Step size against the undistorted field of view.** Steps per manoeuvre must be set against the field COLMAP's fisheye undistortion actually leaves (D-010), not against the raw 160° — the undistortion crops hard, and the remaining field is what governs overlap. Measure it on real frames, then fix the defaults.
   *Done when:* neighbouring undistorted frames from one manoeuvre overlap 70–80 %, and those step counts are the defaults in `capture.py`.

3. **A whole room by manoeuvres.** A real capture drive in which the human only repositions between manoeuvres and closes at least one loop by returning to an earlier standpoint, then walks the same loop a second time at a different distance from the walls. Through `jetbot-run.sh` into the pipeline.
   *Done when:* against a hand-driven drive of the same room, the manoeuvre drive registers at least as many images at no worse reprojection error.

4. **Label wall-following data.** The weakest primitive is the long wall pass, where the open loop drifts and constant distance is hard to hold by keyboard. Label a steering target per frame in the `road_following` manner — one click per image — on frames already captured in packages 2 and 3. No separate collection drive. The tool for it is `jupyter_clickable_image_widget`; context/plan-robot.md rejected that package for the *capture* loop, which needs no labelling UI, and that rejection does not reach this use.
   *Decide before starting:* packages 4–6 are a training subproject on top of a plan that is otherwise pure geometry. The drift they attack can also be attacked for nothing by shortening the step and correcting by hand more often, and packages 1–3 will have shown how bad it actually is. Enter them deliberately, not by momentum.
   *Done when:* a few hundred labelled frames exist on the robot, spanning more than one wall and more than one lighting condition.

5. **Train the regressor on the Nano.** ResNet-18 regression head, trained on the robot as `road_following/train_model.ipynb` does. Training on the device is the point: Torch 1.x and CUDA 10.2 are already there, so no model has to travel. The Mac is the fallback only, and it carries a trap whose edge sits lower than it looks: the zip-based `torch.save` format became the default in PyTorch **1.6**, and only a reader below 1.6 chokes on it — such a writer would have to save with `_use_new_zipfile_serialization=False` against a matching torchvision definition. Whether that applies here is unknown, because the robot's own Torch version is nowhere recorded; JetPack 4.5 ships wheels from 1.6 upward, so it may well not. Read `torch.__version__` on the robot before planning around it.
   *Done when:* on held-out frames the model beats predicting the training set's mean steering value, by mean absolute error. That bar is deliberately low, but it is the one an untrained or collapsed network fails — and "inference runs" is not, since a random network passes it.

6. **Closed-loop wall pass.** The regressor replaces the open-loop wall-pass primitive; the other manoeuvres stay open-loop. The human still handles corners and loop closure.
   *Done when:* the robot drives a wall several metres long alone at roughly constant distance, storing frames, and its drive registers at least as well as the open-loop pass from package 3.

## What this deliberately does not do

No claim of full autonomy — the human supplies coverage and loop closure throughout, and VISION.md's "functional instead of facade" makes that a thing to say out loud rather than stage around. No free-space perception: with a human present and collisions tolerable, the `--min-change` stall gate is the whole safety story. No trained obstacle avoider on the `collision_avoidance` pattern — it learns to drive straight until blocked and then rotate, which is both degeneracies above in one network.

The live overlay that perception would have bought for the presentation is already covered elsewhere: D-012 puts SSD-MobileNet with live detection on the robot regardless.

## Relation to decisions

D-006 holds unchanged — manual control stays the outer loop and this is the "optional expansion" it names. Its consequence clause also defers the decision itself until the vertical slice has run, so the choice lives in OD-003 and earns a D-NNN only after plan-robot package 5. D-013 (stop-and-go) is unchanged: a manoeuvre is several stop-and-go steps in a row.
