---
focus: The robot drives controlled and stores sharp, properly sized images in a folder
next:
  - Package 1 — Boot robot, connect to WiFi, backup SD card
  - Package 2 — Control and live image from the included notebooks
  - Package 3 — Write stop-and-go capture script
blockers: none
---

# Plan robot

> Belongs here: the path from today to the first prototype of the JetBot branch. Not here: hardware facts (context/architecture.md), Mac work (context/plan-pipeline-3d.md).

**Prototype reached when:** a controlled drive through a room section generates a folder of sharp images that pipeline-3d processes without manual rework.

Everything here runs on Python 3.6 (D-008). Each package can be accepted individually.

1. **Robot on network.** Boot, setup WiFi, reach Jupyter in the browser. Before that, backup the SD card — see HT-001, afterwards changes will be made.
   *Done when:* `basic_motion` moves the wheels from the browser.

2. **Control and image.** Put the included `teleoperation` notebook into operation. Mount camera as high as the chassis allows, tilted slightly upwards.
   *Done when:* you drive and see the live image while doing so.

3. **Capture script.** The stop-and-go loop from D-013: drive a bit → stop → wait for oscillation to settle → shot → repeat, while the human dictates the direction. Scale down images to at most 1280×960, in color, filename with timestamp.
   *Done when:* a drive generates a folder in which randomly checked images are sharp.

4. **Transfer.** A command from the Mac fetches the folder.
   *Done when:* the folder resides completely on the Mac.

5. **Prototype.** A real capture drive through a corner of a room, handed over to pipeline-3d.
   *Done when:* a model emerges from it — the proof that both branches fit together.

## Afterwards, not now

Object detection with jetson-inference (D-012) · driving algorithm instead of manual control · log detections per image.
