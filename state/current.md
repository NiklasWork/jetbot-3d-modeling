# Current

> Update the moment a unit of work lands, not at session end. One line per item, no prose — rationale and detail belong in the owning domain file, decision, or git.
> Limits: `next:` ≤5 entries — and only until a domain file declares a `focus:`. Open points then live in that file's `next:` frontmatter and `truss status` builds the register from them; here stay `focus:` (project-wide), `blockers:` (across domains) and `branch:`. See docs/conventions.md, doctor SY-12.
> Recently done: `git log` already carries it, current and without upkeep — `truss status` prints the last commits; see git log for the rest.

focus: pipeline-3d done through package 5; the robot side is written and unexecuted — `repos/robot/checkup.py` is the first thing to run once the device is up, and it decides whether the camera reaches 1280×960 at all

branch: main

blockers: robot not on the network — first boot, WiFi and SSH are physical acts
