# JetBot 3D Modeling — Vision

> Strategic anchor. Headings provide structure.

## Problem

For a university robotics project (group work, presentation in front of the class), a working prototype is needed that generates a walkable 3D model (3D Gaussian Splatting) from video captures of an interior room. The training progress must be visually apparent — this is the core of the presentation.

## Idea

A Waveshare JetBot captures video of a room. On the MacBook M4, camera poses are estimated from this and a 3DGS model is trained — the training progress is visible live (Brush --with-viewer). The finished model is compressed and provided as an interactive web viewer.

Driving is manual, a driving algorithm is an optional expansion (D-006). Staged plan: Capture → Transfer → Process (with visible training) → Web viewer. Live streaming from the JetBot during the drive is a stretch goal, not MVP.

## Principles

- Build minimally, then expand — the working prototype first, then features
- Visualization is mandatory — visible progress at every step
- Quick small wins instead of long planning cycles
- Fun project — visuals count: a result that looks cool beats a complete one
- Functional instead of facade — do not demonstrate anything that doesn't actually run
- **Leave the robot as we found it** — it is shared hardware; touch as little of it as possible, and be able to say at any moment which files, folders and processes on it are ours

## Constraints

- Hardware: Waveshare JetBot (Jetson Nano 4GB, IMX219 160° camera, assembled and flashed), MacBook Air M4 24GB (fanless), Lenovo home server 35GB RAM CPU-only with Coolify — remote, high latency, ~9 Mbit/s upload
- **The JetBot is not ours alone** — other projects run on the same device. Anything we add has to be removable, has to stay out of the shared parts of the system, and has to be documented as ours; the SD card, the camera and the GPU are contended resources, not ours to fill. What this rules out is not written here but where the work is: `repos/robot/README.md` § Our footprint. It is a second, independent reason for D-008 (the stack stays as delivered) — an update would not only buy us nothing, it would break someone else's project
- No NVIDIA GPU server — all ML workloads must run on Apple Silicon / Metal
- Team works via Agentic Engineering (AI-supported development via this channel)
- No fixed deadline — university group work
- Thermal throttling on the MacBook Air expected under sustained load >15 min
