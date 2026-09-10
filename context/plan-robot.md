---
focus: The robot drives controlled and stores sharp, properly sized images in a folder
next:
  - Package 2 — Control and live image from the included notebooks; the mount is partly measured, still open is one frame taken from the floor
  - Package 3 — camera and card are measured and fine; what is left is a lit-room run for the sharpness threshold and a wheels-up check of the motor layer
  - Packages 3 and 4 — never executed; accept on the device per repos/robot/README.md § First run
blockers: none for the camera side. Open before a drive: one `checkup.py` run in a lit room for a real `--min-sharpness`, and a wheels-off-the-ground check that the untested motor layer turns the wheels the way it thinks it does
---

# Plan robot

> Belongs here: the path from today to the first prototype of the JetBot branch. Not here: hardware facts (context/architecture.md), Mac work (context/plan-pipeline-3d.md).

**Prototype reached when:** a controlled drive through a room section generates a folder of sharp images that pipeline-3d processes without manual rework.

Everything here runs on Python 3.6 (D-008). Each package can be accepted individually.

1. ✅ **Robot on network.** Boot, setup WiFi, reach Jupyter in the browser. No SD-card backup is taken — HT-001 settled that recovery is a re-download of the delivery image.
   *Done when:* `basic_motion` moves the wheels from the browser. — **Accepted 2026-09-09.** Boot, WiFi and Jupyter reached, `basic_motion` drives the wheels. Motion only; the camera side of the notebooks is package 2.

2. **Control and image.** Put the included `teleoperation` notebook into operation.
   *Done when:* you drive and see the live image while doing so.
   *The mount does not tilt, and the plan assumed it did.* This file and context/architecture.md both said "as high as the chassis allows, tilted slightly upwards"; the delivered bracket is fixed and points **downwards**. So the capture geometry is not a setting, it is a given.
   *Partly measured 2026-09-10, and milder than feared* — 24 frames in `captures/mount-check-2026-09-10/`, taken with `checkup.py` over SSH at 1640×1232 and 1280×960. What they settle, because it follows from the camera's attitude alone and not from its height: **the ceiling is in frame**, plainly, and the horizon sits just above centre, so the downward tilt is slight. The fear of "walls at the top edge, ceiling not at all" is wrong.
   *What they do not settle:* how much of the frame the floor takes. The robot was standing on a **table**, so the near surface filling the lower ~57 % is a tabletop ending after about 1.5 m, where a floor would run on to the wall. That fraction is the thing worth knowing and it still needs one frame taken from the floor.
   *Also seen, and unexplained:* a strong magenta cast on every frame, identical on the first and the twelfth, so it is not sensor warm-up. Irrelevant to geometry, relevant to whether a model built from these photos comes out pink.
   If a floor frame turns out bad, the fixes are physical (shim the bracket, raise the mount) and belong in HUMAN-TODOS.md, not in code.

3. **Capture script.** The stop-and-go loop from D-013: drive a bit → stop → wait for oscillation to settle → shot → repeat, while the human dictates the direction. Scale down images to at most 1280×960, in color. Filenames are **sequentially numbered, not timestamped** — the numbering is the interface to `sequential_matcher`, and a timestamp adds nothing the file mtime does not already carry while giving the sort order one more way to break.
   *Done when:* a drive generates a folder in which randomly checked images are sharp. — `repos/robot/capture.py` is written but has **never been executed**, on hardware or otherwise; nothing about it is verified. `repos/robot/checkup.py` is the first thing to run on the device and settles the resolution and write-rate questions below before a drive is attempted.
   *Start from:* `road_following/data_collection_gamepad.ipynb` on the image — it already drives by gamepad and writes one frame per button press; strip the label logic, raise the resolution, number the files sequentially. Searched 2026-09-07: no public JetBot + 3DGS project exists, so this notebook is the only template there is.
   ✅ **Camera settled on the device 2026-09-10.** `checkup.py --probe-only --all-modes` ran against the real robot and **all five candidate resolutions deliver**, target 1280×960 and native 1640×1232 included. The write test at 1280×960 q92: 0.106 s per frame against the ~1.0 s a capture step has, 35.3 MB/s reaching the card, GPU already delivering the right size so the CPU never rescales. Neither gate is a problem. Twenty frames in `captures/checkup-2026-09-10/`.
   *What the same run did **not** settle, and why it matters:* the room was dark, so the frames are black ramping into pure colour noise as the ISP wound the gain up. **The sharpness numbers from that run are worthless** — Laplacian variance reads amplified noise as sharp, and the script duly proposed `--min-sharpness 30` from it, a threshold that would pass noise and reject real frames. `checkup.py` now measures whether a scene is there at all (brightness plus the standard deviation of the frame shrunk 16×, since noise averages away and furniture does not) and withholds the threshold when it is not. Verified firing on the device. **Re-run it in a lit room to get a real threshold.**
   *Blocker resolved 2026-09-10, the code change is done:* `capture.py` and `checkup.py` both import `jetbot`, and on this host that can never work — measured, not assumed. The package is not installed; `~/jetbot` is only the git clone, and importing it from the home directory yields an empty namespace package that fails later with `cannot import name 'Camera'`. Put the real package on the path and `__init__.py` still demands `ipywidgets` (49 apt packages) and `Adafruit_MotorHAT` via a chain that needs a C compiler (10 more) — about sixty packages on a shared robot with 1.5 GB free, for `Heartbeat` and `ObjectDetector` we never call. **Both scripts must take the two things they need directly instead:** the camera through `cv2` + `nvarguscamerasrc`, which is the path that produced the mount-check frames, and the motors through `Adafruit_MotorHAT` (now installed, HAT confirmed at i2c-1 `0x60`). Full reasoning and the footprint are in `repos/robot/README.md` § Our footprint. `capture.py` now carries `GstCamera`, its own GStreamer pipeline behind the same `.value`/`.stop()` interface `_grab()` already expected, and `_motor_pair_class()`, which mirrors jetbot 0.4.3's `motor.py` and `robot.py` line for line on top of `Adafruit_MotorHAT`. Neither script imports `jetbot` any more, and both were run on the device. **The motor half has never driven a wheel** and was written under an explicit instruction not to move the robot: put it on a stand and confirm that a positive value turns both wheels forwards before the first drive.
   *Trap:* every JetBot notebook instantiates the camera at 224×224, ResNet training resolution. 3DGS needs ≥1280×960, so the `Camera` class must be reconfigured and the SD card write rate becomes a factor. `checkup.py` walks the candidate resolutions and measures the card; `NVIDIA-AI-IOT/jetcam` is the fallback if no configuration reaches 1280×960.
   *Both `nerf_bridge` filters are in the code:* `--min-sharpness` (Laplacian variance, re-settles and re-grabs rather than leaving a hole in the numbering) and `--min-change` (mean pixel difference to the last stored frame, catches a stalled robot). Command-line flags, so the two thresholds are what gets tuned on the device without a code change. The sharpness scale depends on scene *and* resolution, which is why the default is off and `checkup.py` proposes a starting value.

4. **Transfer.** A command from the Mac fetches the folder.
   *Done when:* the folder resides completely on the Mac. — `repos/robot/jetbot-run.sh` fetches and runs the pipeline in one command; unrun against a real robot.

5. **Prototype.** A real capture drive through a corner of a room, handed over to pipeline-3d.
   *Done when:* a model emerges from it — the proof that both branches fit together.

## Afterwards, not now

Object detection with jetson-inference (D-012) · the driving algorithm, decided as D-014 and planned in context/plan-driving.md · log detections per image.

Evaluated 2026-09-07 and deliberately not adopted, so it is not researched again: `jetracer` (its data-collection UI is redundant once capture.py exists) · `jupyter_clickable_image_widget` (we need no labelling UI) · `torch2trt` (a sharpness check is OpenCV, not a network) · `jetbot_ros` (the robot/Mac interface stays a folder of images, D-011) · `jdgalviss/jetbot-ros2` (only if the live-stream stretch goal returns). Looks fitting but is not: `ros2_jetbot_tools`, `jetbot_maze`, `isaac_ros_visual_slam`, `nanoowl`, `nanosam` — all require JetPack 5+ or Ubuntu 20.04/22.04.
