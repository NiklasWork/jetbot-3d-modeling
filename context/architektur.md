# Architecture

> Belongs here: Role division of the machines, the two development branches, and the staged plan. Not here: tool choice (state/decisions/), open questions (state/open-decisions.md).

## Role division

The boundary is latency, not compute: whatever must react in under ~100 ms runs on the robot; everything else on the Mac.

- **JetBot** — Sensor and actuator. Driving, capture the camera image, stream image for the control UI, store shots. Later optionally a small pre-trained model in the drive cycle. Never: pose estimation, never 3DGS training.
- **MacBook M4** — Compute and stage. Pose estimation, 3DGS training with visible live viewer, conversion to `.sog`. Never controls the robot in real-time.
- **Lenovo server (Coolify)** — Showcase, nothing else (D-007). Static hosting of the finished model. No GPU, not upgradable, 4 cores — as a compute node for every task here slower than the Mac. Hard limit: **~9 Mbit/s upload**. A 50 MB model takes almost a minute per request with this; a lecture hall loading simultaneously brings the connection to a standstill. Therefore, serve it locally from the Mac for the demonstration and consider the web link as a takeaway afterwards.

## Hardware reality JetBot

Confirmed via the flashed image `jetbot-043_nano-4gb-jp45`: classic Jetson Nano 4GB, 128-core Maxwell GPU, ~0.5 TFLOPS, 4 GB shared memory — no Orin. Software: JetBot 0.4.3 on JetPack 4.5 (Ubuntu 18.04, Python 3.6, CUDA 10.2, TensorRT 7.1), frozen per D-008. This carries small, older models in the drive cycle and nothing else.

**Python can be upgraded, it just doesn't help.** A newer Python is installable on Ubuntu 18.04 (deadsnakes or custom build), but NVIDIA provides CUDA-capable PyTorch wheels exclusively for the included Python 3.6 — even the official `l4t-pytorch` container is 3.6. Anything above that would mean compiling PyTorch from scratch with CUDA. And the actual ceiling is lower than Python: the Maxwell GPU can only do CUDA 10.2, PyTorch 2.x requires CUDA 11+. A modern Torch stack is therefore unreachable on this hardware regardless of the Python version. If you still want to run a newer model, go via ONNX → TensorRT 7.1: this runs GPU-accelerated from within Python 3.6 and makes the model choice independent of the Python version.

The image comes with the JetBot notebooks — `basic_motion` and `teleoperation` already provide the manual control including live camera image from D-006 out of the box, `collision_avoidance` and `road_following` are the template for the optional driving algorithm.

## Staged plan

Every stage is demonstrable on its own. No stage depends on a later one.

1. **Stage 0 — Pipeline without robot.** Public dataset → Brush with live viewer on the Mac → `.sog` → SuperSplat **locally on the Mac**. Proves the entire back half and immediately delivers the visually strongest artifact of the project. The rollout to the Lenovo is postponed: it only changes the address where the same viewer resides, and will be caught up at the end if needed.
2. **Stage 1 — Robot drives, image arrives.** Manual control with live camera image in the browser. Depends on nothing from stage 0.
3. **Stage 2 — Connect.** Robot captures, Mac computes, result lands in the viewer. Capture geometry is the quality factor here: camera as high as the chassis allows and tilted slightly upwards, loops instead of straight driving, lots of light, rather a well-captured part of a room than a poorly captured entire room.
4. **Stage 3 — Expansion.** In any order: object detection with 3D placement in the model (D-012), driving algorithm, rollout to the Lenovo, reconstruction during the drive.

## Two development branches

Separate repos, separate runtime, separately demonstrable (D-011). They meet at exactly one point: the folder with images that the robot generates and the pipeline reads.

| | `repos/pipeline-3d/` | `repos/roboter/` |
|---|---|---|
| Runs on | MacBook M4, macOS | JetBot, Ubuntu 18.04 |
| Language | Python 3.14 / Shell | **Python 3.6** — no walrus, no dataclasses |
| Tools | COLMAP, Brush, splat-transform | JetBot 0.4.3, jetson-inference |
| Delivers | the 3D model and the viewer | images, control, object detections |
| Demonstrable as | growing model in the live viewer | driving robot with live detection |

The interface is deliberately dumb: a folder with images plus one file with detections per image. No protocol, no network API, no shared library — this way each side remains executable and individually repairable without the other.
