# Current

> Update the moment a unit of work lands, not at session end. One line per item, no prose — rationale and detail belong in the owning domain file, decision, or git.
> Limits: `next:` ≤5 entries — and only until a domain file declares a `focus:`. Open points then live in that file's `next:` frontmatter and `truss status` builds the register from them; here stay `focus:` (project-wide), `blockers:` (across domains) and `branch:`. See docs/conventions.md, doctor SY-12.
> Recently done: `git log` already carries it, current and without upkeep — `truss status` prints the last commits; see git log for the rest.

focus: pipeline-3d done through package 5; the robot side is written and unexecuted — `repos/robot/checkup.py` is the first thing to run once the device is up, and it decides whether the camera reaches 1280×960 at all. `jetbot-run.sh`'s fetch has since been run end to end against a stand-in robot, so what is still untested there is the device, not the Mac side. Engine lifted to main at rc.3+2 (`d4b14ee`)

branch: main

blockers: robot not on the network — first boot, WiFi and SSH are physical acts

latent: [2026-09-08] `doctor` reports `ST-09` naming 4 engine files as locally adapted — that is upstream's stale manifest, not an edit of ours; never "restore" the engine over it. Clears when upstream cuts a release that regenerates `MANIFEST.sha256`; see TF-001
