# Current

> Update the moment a unit of work lands, not at session end. One line per item, no prose — rationale and detail belong in the owning domain file, decision, or git.
> Limits: `next:` ≤5 entries — and only until a domain file declares a `focus:`. Open points then live in that file's `next:` frontmatter and `truss status` builds the register from them; here stay `focus:` (project-wide), `blockers:` (across domains) and `branch:`. See docs/conventions.md, doctor SY-12.
> Recently done: `git log` already carries it, current and without upkeep — `truss status` prints the last commits; see git log for the rest.

focus: pipeline-3d done through package 5; robot capture and transfer written but never run — everything now waits on the physical bring-up

branch: main

blockers: robot not on the network — first boot, WiFi and SSH are physical acts. HT-001 under review: the delivery image `jetbot-043_nano-4gb-jp45.zip` is still on the Mac, which voids the reason the entry gives for itself
