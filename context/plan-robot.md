---
focus: The robot drives controlled and stores sharp, properly sized images in a folder
next:
  - Package 1 — Boot robot, connect to WiFi, reach Jupyter in the browser
  - Package 2 — Control and live image from the included notebooks
  - Package 3 — `checkup.py` first on the device: it decides whether the camera reaches 1280×960 and whether the card keeps up
  - Packages 3 and 4 — never executed; accept on the device per repos/robot/README.md § First run
blockers: none
---

# Plan robot

> Belongs here: the path from today to the first prototype of the JetBot branch. Not here: hardware facts (context/architecture.md), Mac work (context/plan-pipeline-3d.md).

**Prototype reached when:** a controlled drive through a room section generates a folder of sharp images that pipeline-3d processes without manual rework.

Everything here runs on Python 3.6 (D-008). Each package can be accepted individually.

1. **Robot on network.** Boot, setup WiFi, reach Jupyter in the browser. No SD-card backup is taken — HT-001 settled that recovery is a re-download of the delivery image.
   *Done when:* `basic_motion` moves the wheels from the browser.

2. **Control and image.** Put the included `teleoperation` notebook into operation. Mount camera as high as the chassis allows, tilted slightly upwards.
   *Done when:* you drive and see the live image while doing so.

3. **Capture script.** The stop-and-go loop from D-013: drive a bit → stop → wait for oscillation to settle → shot → repeat, while the human dictates the direction. Scale down images to at most 1280×960, in color. Filenames are **sequentially numbered, not timestamped** — the numbering is the interface to `sequential_matcher`, and a timestamp adds nothing the file mtime does not already carry while giving the sort order one more way to break.
   *Done when:* a drive generates a folder in which randomly checked images are sharp. — `repos/robot/capture.py` is written but has **never been executed**, on hardware or otherwise; nothing about it is verified. `repos/robot/checkup.py` is the first thing to run on the device and settles the resolution and write-rate questions below before a drive is attempted.
   *Start from:* `road_following/data_collection_gamepad.ipynb` on the image — it already drives by gamepad and writes one frame per button press; strip the label logic, raise the resolution, number the files sequentially. Searched 2026-09-07: no public JetBot + 3DGS project exists, so this notebook is the only template there is.
   *Trap:* every JetBot notebook instantiates the camera at 224×224, ResNet training resolution. 3DGS needs ≥1280×960, so the `Camera` class must be reconfigured and the SD card write rate becomes a factor. `checkup.py` walks the candidate resolutions and measures the card; `NVIDIA-AI-IOT/jetcam` is the fallback if no configuration reaches 1280×960.
   *Both `nerf_bridge` filters are in the code:* `--min-sharpness` (Laplacian variance, re-settles and re-grabs rather than leaving a hole in the numbering) and `--min-change` (mean pixel difference to the last stored frame, catches a stalled robot). Command-line flags, so the two thresholds are what gets tuned on the device without a code change. The sharpness scale depends on scene *and* resolution, which is why the default is off and `checkup.py` proposes a starting value.

4. **Transfer.** A command from the Mac fetches the folder.
   *Done when:* the folder resides completely on the Mac. — `repos/robot/jetbot-run.sh` fetches and runs the pipeline in one command; unrun against a real robot.

5. **Prototype.** A real capture drive through a corner of a room, handed over to pipeline-3d.
   *Done when:* a model emerges from it — the proof that both branches fit together.

## Afterwards, not now

Object detection with jetson-inference (D-012) · the driving algorithm, planned in context/plan-driving.md and gated on OD-003 · log detections per image.

Evaluated 2026-09-07 and deliberately not adopted, so it is not researched again: `jetracer` (its data-collection UI is redundant once capture.py exists) · `jupyter_clickable_image_widget` (we need no labelling UI) · `torch2trt` (a sharpness check is OpenCV, not a network) · `jetbot_ros` (the robot/Mac interface stays a folder of images, D-011) · `jdgalviss/jetbot-ros2` (only if the live-stream stretch goal returns). Looks fitting but is not: `ros2_jetbot_tools`, `jetbot_maze`, `isaac_ros_visual_slam`, `nanoowl`, `nanosam` — all require JetPack 5+ or Ubuntu 20.04/22.04.
