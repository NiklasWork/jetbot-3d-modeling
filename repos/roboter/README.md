# roboter

Everything that runs on the JetBot: drive, capture, later detect objects.
Generates the image folder that `pipeline-3d` processes further — and works without it.

## Target system

| | |
|---|---|
| Device | Waveshare JetBot, Jetson Nano 4GB |
| Image | `jetbot-043_nano-4gb-jp45` — JetBot 0.4.3, JetPack 4.5 |
| OS | Ubuntu 18.04, **Python 3.6**, CUDA 10.2, TensorRT 7.1 |
| Access | Jupyter in the browser, `http://<jetbot-ip>:8888`, user/password `jetbot` |

> **Python 3.6 is binding.** No dataclasses (3.7), no walrus operator (3.8),
> no `ultralytics`. The stack is deliberately frozen — updates are not available for this
> hardware, see decision D-008 in the workspace.

## What is built here

1. **Control** — comes with the image (`teleoperation`, `basic_motion`).
2. **Capture** — write images into a folder, named by timestamp.
3. **Object detection** — pre-trained SSD-MobileNet via `jetson-inference`,
   log detections per image. The mapping to 3D coordinates happens
   **not here**, but on the Mac from the COLMAP poses.

## Status

Robot is built and flashed, nothing else. Next step: boot, connect to WiFi,
open `teleoperation` notebook.

## Limitations

- No wheel encoders, no IMU — the robot cannot reliably track its own path.
  The camera trajectory comes from the reconstruction on the Mac.
- Rolling shutter camera: images during the drive become blurry indoors.
- No more security updates. Belongs in the home network, not in open WiFi.

Planning, rationales and open questions belong not here, but in the Truss workspace one level higher.
