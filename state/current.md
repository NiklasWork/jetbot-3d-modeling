# Current

> Update the moment a unit of work lands, not at session end. One line per item, no prose — rationale and detail belong in the owning domain file, decision, or git.
> Limits: `next:` ≤5 entries — and only until a domain file declares a `focus:`. Open points then live in that file's `next:` frontmatter and `truss status` builds the register from them; here stay `focus:` (project-wide), `blockers:` (across domains) and `branch:`. See docs/conventions.md, doctor SY-12.
> Recently done: `git log` already carries it, current and without upkeep — `truss status` prints the last commits; see git log for the rest.

focus: pipeline-3d done through package 5; the robot is on the network since 2026-09-09 — boot, WiFi, Jupyter and `basic_motion` driving the wheels from the browser are accepted, so plan-robot package 1 is done. The rest of the robot side is still written and unexecuted — `repos/robot/checkup.py` is the first thing to run on the device, and it decides whether the camera reaches 1280×960 at all. `jetbot-run.sh`'s fetch has since been run end to end against a stand-in robot, so what is still untested there is the device, not the Mac side. The driving algorithm is decided (D-014) and its package 1 — manoeuvres in `capture.py` — is built and verified against a stand-in robot; packages 2 and 3 are measurements that need the device. Engine lifted to main at rc.3+2 (`d4b14ee`). Alongside, and independent of the hardware: the JCFS presentation deck is built and published (context/presentation.md), rebuilt 2026-09-09 against the human's review. `compress` now stands its models upright before packaging them — OD-004 asks whether it should also emit the collision data the viewer needs before it lets anyone walk

branch: main

blockers: none — the robot came onto the network 2026-09-09. What is left on that side needs time at the device, not an unblock.

latent: [2026-09-08] `doctor` reports `ST-09` naming 4 engine files as locally adapted — that is upstream's stale manifest, not an edit of ours; never "restore" the engine over it. Clears when upstream cuts a release that regenerates `MANIFEST.sha256`; see TF-001
