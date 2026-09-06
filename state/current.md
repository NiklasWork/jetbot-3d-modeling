# Current

> Update the moment a unit of work lands, not at session end. One line per item, no prose — rationale and detail belong in the owning domain file, decision, or git.
> Limits: `next:` ≤5 entries — and only until a domain file declares a `focus:`. Open points then live in that file's `next:` frontmatter and `truss status` builds the register from them; here stay `focus:` (project-wide), `blockers:` (across domains) and `branch:`. See docs/conventions.md, doctor SY-12.
> Recently done: `git log` already carries it, current and without upkeep — `truss status` prints the last commits; see git log for the rest.

focus: pipeline-3d done through package 5 and hardened; package 6 needs a second person, robot strand needs HT-001

branch: main

blockers: robot strand cannot start until HT-001 (SD card backup) is done — a physical act
