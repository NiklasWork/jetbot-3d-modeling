## Project

name: JetBot 3D Modeling
language: English
code-root:
<!-- optional relative directory holding the work product; overlay default repo/; empty = none -->
pm-method: kanban

## Tools & subscriptions

Only proven projects: many stars or an official development team. Prefer a few good ones over many small ones.

- Brush (ArthurBrussee/brush) — 3DGS training, Metal/WGPU, 5.0k ★, Apache-2.0
- COLMAP (colmap/colmap) — pose estimation and undistortion, 12.6k ★, via Homebrew
- SuperSplat (playcanvas/supersplat) — web viewer, 9.9k ★, MIT
- jetson-inference (dusty-nv/jetson-inference) — object detection on the JetBot, 9.0k ★, MIT
- JetBot (NVIDIA-AI-IOT/jetbot) — robot control, 3.3k ★, MIT — resides as 0.4.3 on the image
- ffmpeg — only fallback and screen captures now (stop-and-go instead of video, D-013)
- rsync 3.5.0 (GNU, Homebrew) — installed 2026-09-08 and ahead of /usr/bin/rsync on PATH, so `jetbot-run.sh` gets `--info=progress2` and needs no `RSYNC=` override; macOS' own openrsync has neither the option nor reliable protocol compatibility with the robot
- Coolify — deployment on the Lenovo, postponed

## Style & moral

<!-- The home for "remember this": when the human states a durable rule about how you
     work — language, tone, how much to plan, what to ask before acting, what never to
     do — write it here in the same turn, never leave it in the chat. One imperative
     line each, no rationale prose, ~10 per section; a new preference replaces the line
     it contradicts — this is current configuration, not a history. Routing of the
     non-preference cases: docs/conventions.md § Profile. -->

- Always the simplest path first
- Prefer a working prototype over a perfect plan
- Prioritize visualization and presentability
- No speculative features or "for later" structures
